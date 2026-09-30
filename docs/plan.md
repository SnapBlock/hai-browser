# hai-browser (H/Ai): plan

## Goal

Let a human and any MCP agent (Claude Code first) work in the **same** VS Code integrated-browser tab, and connect what's on screen back to the source code that rendered it. Local-first: no hosted service, no telemetry.

Non-goals for v0.x: controlling sites outside the integrated browser, OS-level desktop control, cloud sync.

## Architecture

```
Claude Code ──stdio──▶ hai-browser-mcp ──ws 127.0.0.1 + token──▶ extension ──CDP──▶ integrated browser tab
```

- **Attach route.** VS Code's browser-tab API (`window.openBrowserTab`, `BrowserTab.startCDPSession`) is still proposed, so published extensions can't call it. The built-in JavaScript debugger can: the extension starts an `editor-browser` debug session (`request: "launch"` with a URL, or `"attach"`, which shows the user a tab picker), waits for the child `pwa-editor-browser` session and calls `extension.js-debug.requestCDPProxy` to get a CDP WebSocket for that page.
- **Visibility quirk.** Over this route the page reports `visibilityState: "hidden"` and Chromium drops mouse presses for hidden pages. On attach the extension enables `Emulation.setFocusEmulationEnabled` and calls `Page.bringToFront` (again before each click). With that, clicks arrive as trusted events.
- **Console.** js-debug consumes `Runtime` events itself; the extension receives them via `JsDebug.subscribe`.
- **Discovery.** One lockfile per VS Code window in `~/.hai-browser/sessions/` (dir `0700`, file `0600`) with port, token and workspace folders. The MCP server picks the window whose workspace contains its working directory, otherwise the newest live one.
- **Source tagging.** `hai-browser-vite` (dev server only, `enforce: 'pre'`) parses `.jsx`/`.tsx` with `@babel/parser` and inserts `data-hai-src="path:line:col"` on intrinsic elements with `magic-string`, keeping source maps. Paths are relative to the Vite root, which the plugin publishes as `<meta name="hai-browser-root">`; the extension resolves against that root, then workspace folders, then a workspace search.
- **Next.js.** `hai-browser-next` runs the same transform as a webpack-style loader. `withHaiBrowser(config)` returns a config function that, only in `phase-development-server`, adds `turbopack.rules['*.{jsx,tsx}'] = { condition: { not: 'foreign' }, loaders: ['hai-browser-next/loader'] }` ahead of any existing rules, plus an `enforce: 'pre'` webpack rule when `options.dev`. The loader sees the original source before SWC, so server and client components get identical tags (no hydration mismatch). Next has no HTML hook, so the loader adds `data-hai-root="<project dir>"` to the root layout's `<html>` element instead of the meta tag.
- **Picking.** A page script draws a hover overlay and captures the next click in the capture phase (mouse/pointer down/up are swallowed too, so the page never sees it). The extension polls the pick state over `Runtime.evaluate`, which survives navigations without needing CDP bindings. A pick opens the file beside the browser and becomes the selection `browser_get_selection` returns.
- **Snapshots.** A page script builds an accessibility-style outline and assigns refs (`e1`, `e2`, …) held in a `WeakRef` map on `window.__hai`. Refs reset on every snapshot; stale refs return an explicit error. Password and `cc-*` values are redacted.

## Milestones

| Phase | Scope | Status |
|---|---|---|
| 0 | Extension + MCP bridge: open/share, navigate, snapshot, click, type, press, screenshot, console, gated evaluate | **done** (verified in VS Code 1.140) |
| 1 | Element → source: `data-hai-src="file:line:col"` via Vite plugin (React/JSX); "H/Ai: Pick Element" opens the file; `browser_get_selection` returns element, source, styles, screenshot | **done** (Vite 8, React 19, VS Code 1.140) |
| 2 | Next.js tagging (Turbopack + webpack) via `hai-browser-next`; loader usable in other webpack setups | **done** (Next.js 16.3, both bundlers) |
| 3 | Collaboration: component-level mapping (owner component + props via React DevTools hook),  agent activity overlay in the page, "take over" / pause agent, confirmation before form submits on non-localhost origins, domain allowlist | |
| 4 | Network log tool, multi-tab support, standalone Babel plugin for non-webpack/Vite setups | |
| 5 | Publish: Marketplace + Open VSX + `npx hai-browser-mcp`; docs site on GitHub Pages | |

## Risks

- **js-debug internals.** `requestCDPProxy` and the `editor-browser` debug type are public but not a formal extension API. If VS Code stabilises the browser-tab API we switch to it; if the route breaks we pin minimum versions and detect at startup.
- **Competition.** VS Code's own chat already has browser tools and "Add element to chat". Our edge: works from Claude Code in the terminal and other MCP agents, and maps elements to source lines.
- **Prompt injection.** Page content is untrusted. Tool descriptions say so; evaluate is off by default; phase 3 adds confirmations and allowlists.
- **Turbopack loader API** is a subset of webpack's (`loader-runner`). The tagging loader only uses `resourcePath`, `rootContext` and `callback`; if Turbopack changes rule semantics, `turbopack.rules` conditions are the thing to re-check.

## Testing

- Unit: lockfile selection (`packages/mcp/test`), JSX tagging (`packages/vite-plugin/test`), `data-hai-src` parsing (`packages/protocol/test`), Next config merging and loader (`packages/next-plugin/test`). Next: snapshot/redaction tests against jsdom.
- End to end, against a running VS Code: `pnpm smoke` drives `examples/demo`; `smoke:pick` has the agent request a pick on `examples/vite-react` and checks the source maps to `src/PlanCard.tsx` and the click never reached the page; `HAI_PICK_APP=next` does the same on `examples/next-app` (run against both `dev` and `dev:webpack`) and also checks for hydration errors. Automating these in CI needs `@vscode/test-electron` + xvfb.
