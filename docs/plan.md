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
- **Snapshots.** A page script builds an accessibility-style outline and assigns refs (`e1`, `e2`, …) held in a `WeakRef` map on `window.__hai`. Refs reset on every snapshot; stale refs return an explicit error. Password and `cc-*` values are redacted.

## Milestones

| Phase | Scope | Status |
|---|---|---|
| 0 | Extension + MCP bridge: open/share, navigate, snapshot, click, type, press, screenshot, console, gated evaluate | **done** (verified in VS Code 1.140) |
| 1 | Element → source: `data-hai-src="file:line:col"` via Vite/Babel plugin (React first); "H/Ai: Pick Element" opens the file; `browser_get_selection` tool returns element, source, styles, screenshot | next |
| 2 | Collaboration: agent activity overlay in the page, "take over" / pause agent, confirmation before form submits on non-localhost origins, domain allowlist | |
| 3 | Next.js (SWC/Turbopack) tagging, network log tool, multi-tab support | |
| 4 | Publish: Marketplace + Open VSX + `npx hai-browser-mcp`; docs site on GitHub Pages | |

## Risks

- **js-debug internals.** `requestCDPProxy` and the `editor-browser` debug type are public but not a formal extension API. If VS Code stabilises the browser-tab API we switch to it; if the route breaks we pin minimum versions and detect at startup.
- **Competition.** VS Code's own chat already has browser tools and "Add element to chat". Our edge: works from Claude Code in the terminal and other MCP agents, and maps elements to source lines.
- **Prompt injection.** Page content is untrusted. Tool descriptions say so; evaluate is off by default; phase 2 adds confirmations and allowlists.
- **Source tagging on React 19 / Turbopack** is the least certain part of phase 1.

## Testing

- Unit: lockfile selection (`packages/mcp/test`). Next: snapshot/redaction tests against jsdom.
- End to end: `pnpm smoke` drives `examples/demo` through the real MCP server against a running VS Code. Automating this in CI needs `@vscode/test-electron` + xvfb; planned for phase 1.
