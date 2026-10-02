# H/Ai — hai-browser

Share VS Code's integrated browser with **Claude Code**, **GitHub Copilot**, **Codex CLI**, **Gemini CLI**, **Cline** or any other MCP agent. You and the agent work in the same browser tab: it reads the page, clicks and types with real input, takes screenshots and watches the console, while you watch and take over at any time.

Point at an element and H/Ai opens the line of code that rendered it, and the agent gets the same element (source location, HTML, styles, screenshot), so *"make this button match the header"* just works.

> Status: **prototype** (phases 0–2). See [docs/plan.md](docs/plan.md).

## How it works

```
Claude Code ──stdio MCP──▶ hai-browser-mcp ──ws://127.0.0.1 (token)──▶ H/Ai VS Code extension
                                                                          │ editor-browser debug session
                                                                          │ + js-debug requestCDPProxy
                                                                          ▼
                                                               VS Code integrated browser tab (CDP)
```

- The extension attaches to an integrated-browser tab through VS Code's built-in JavaScript debugger (`editor-browser` debug type) and asks it for a Chrome DevTools Protocol proxy (`extension.js-debug.requestCDPProxy`). This uses only stable, public APIs, so it works in published extensions.
- Each VS Code window runs a localhost-only WebSocket server and writes a lockfile (`~/.hai-browser/sessions/<pid>.json`, mode `0600`) with its port and a random token.
- `hai-browser-mcp` picks the window whose workspace contains the agent's working directory and forwards tool calls to it.

Everything runs on your machine. There is no hosted service and no telemetry.

## Requirements

- VS Code **1.119+** (integrated browser + built-in JavaScript debugger). **VSCodium** and **Windsurf** work too; they install H/Ai from [Open VSX](https://open-vsx.org/extension/hai-browser/hai-browser). **Cursor** and **Antigravity** don't yet: Cursor ships without VS Code's integrated browser, and Antigravity is based on VS Code 1.107.
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code), GitHub Copilot, Codex CLI, Gemini CLI, Cline or another MCP client
- Node.js **20+** to build from source (installed users can do without it; H/Ai falls back to VS Code's runtime)

## Install

1. Install the extension: search for **H/Ai Browser** in VS Code's Extensions view, or run `code --install-extension hai-browser.hai-browser`. You can also download `hai-browser.vsix` from the [latest release](https://github.com/SnapBlock/hai-browser/releases/latest) and run `code --install-extension hai-browser.vsix`, or use the one-line installer:

   ```sh
   # macOS / Linux
   curl -fsSL https://raw.githubusercontent.com/SnapBlock/hai-browser/main/scripts/install.sh | sh
   ```

   ```powershell
   # Windows (PowerShell)
   irm https://raw.githubusercontent.com/SnapBlock/hai-browser/main/scripts/install.ps1 | iex
   ```

2. Open a folder in VS Code and trust it (the extension does not run in Restricted Mode). H/Ai asks **"let Claude Code use this browser?"**. Click **Connect Claude Code**. You can run it again any time with **H/Ai: Connect Claude Code**.
3. Start `claude` in that folder (VS Code's terminal is easiest) and ask it to open your app, e.g. *"open http://localhost:5173 and check the signup form works"*. Or share a tab you already have open with **H/Ai: Share Browser Tab with Agent** (also in the status bar).

The MCP server ships inside the extension. Connecting copies it to `~/.hai-browser/mcp/index.mjs` (kept up to date when the extension updates) and runs `claude mcp add --scope user hai-browser -- node ~/.hai-browser/mcp/index.mjs`. If Node.js 20+ isn't on your PATH, it uses VS Code's own runtime instead.

### Other agents

- **GitHub Copilot (agent mode in VS Code):** nothing to set up. H/Ai registers its MCP server with VS Code, so its tools show up in the chat's tools list.
- **Codex CLI, Gemini CLI, Cline and other MCP clients:** run **H/Ai: Connect Other Agents**, pick your agent, and H/Ai copies the setup to your clipboard. It's the same server either way (the path exists once H/Ai has run in VS Code):

  ```sh
  codex mcp add hai-browser -- node ~/.hai-browser/mcp/index.mjs
  gemini mcp add --scope user hai-browser node ~/.hai-browser/mcp/index.mjs
  ```

  For JSON-configured clients such as Cline, add `{"mcpServers": {"hai-browser": {"command": "node", "args": ["/Users/<you>/.hai-browser/mcp/index.mjs"]}}}` with your real home path.

## Setup from source

```sh
pnpm install
pnpm build
pnpm --filter hai-browser package   # packages/extension/hai-browser.vsix
```

Install that VSIX (or press **F5**, "Run hai-browser extension", in this repo) and connect as above. Pushing a `v*` tag that matches the extension's `version` builds the VSIX, attaches it to a GitHub release, and publishes it to the VS Code Marketplace (repo secret `VSCE_PAT`) and Open VSX (`OVSX_PAT`) when those secrets are set.

The npm plugins publish separately through npm trusted publishing (no token): bump the plugin's `version`, then push a tag named `<package>@<version>`, e.g. `hai-browser-vite@0.0.2`. [`.github/workflows/npm-publish.yml`](.github/workflows/npm-publish.yml) checks the tag matches and runs `npm publish`.

## Jump from the page to the code

Add the dev-only plugin for your framework (React/JSX; production builds are untouched).

**Vite**

```sh
npm install -D hai-browser-vite
```

```ts
// vite.config.ts
import react from '@vitejs/plugin-react';
import hai from 'hai-browser-vite';

export default defineConfig({ plugins: [hai(), react()] });
```

**Next.js** (Turbopack or `--webpack`, App or Pages Router, server and client components)

```sh
npm install -D hai-browser-next
```

```ts
// next.config.ts
import { withHaiBrowser } from 'hai-browser-next';

export default withHaiBrowser({ /* your config */ });
```

`withHaiBrowser` only changes the config under `next dev`. It adds a `turbopack.rules` loader for `*.jsx`/`*.tsx` (skipping `node_modules`) and, for webpack dev builds, the same loader as an `enforce: 'pre'` rule. Other webpack setups can use the loader directly: `{ test: /\.[jt]sx$/, exclude: /node_modules/, enforce: 'pre', use: ['hai-browser-next/loader'] }`.

It tags each HTML element with where it was written, e.g. `<button data-hai-src="src/PlanCard.tsx:6:7">`. Components are not tagged themselves (they may not pass unknown props to the DOM), so you land on the JSX element inside the component.

Then run **H/Ai: Pick Element and Open Source** (status bar **Pick** while a tab is shared), hover to highlight, and click. The click is captured rather than sent to the page, VS Code opens the file at that line beside the browser, and the element becomes the agent's current selection. Esc cancels.

Agents read it with `browser_get_selection`, or call it with `wait: true` to ask you to pick something. Snapshots also show `src=file:line:col` next to each tagged element.

## Tools

| Tool | What it does |
|---|---|
| `browser_status` | Whether a tab is shared, plus URL and title |
| `browser_open` | Open a URL in the shared tab. With none shared, reuses an open tab already showing that URL, else opens a new one |
| `browser_request_share` | Ask the user to pick one of their open tabs to share |
| `browser_navigate` | Go to a URL, or back / forward / reload |
| `browser_snapshot` | Accessibility-style outline with `[ref=eN]` handles |
| `browser_click` | Click by ref or `x`/`y` (trusted mouse input); right/middle button, double click, modifier keys |
| `browser_hover` | Move the mouse over a ref or point |
| `browser_scroll` | Mouse-wheel scroll at a ref, point or the viewport centre, or scroll a ref into view |
| `browser_drag` | Press, move and release between two refs/points (sliders, sortable lists) |
| `browser_type` | Type into an element by ref, optionally clear and submit |
| `browser_press_key` | Press a key or chord (`Enter`, `ArrowDown`, `Control+A`, `Shift+Tab`, …) |
| `browser_select_option` | Pick `<select>` options by value or label |
| `browser_upload_file` | Set a file input's files (paths must be inside the workspace) |
| `browser_handle_dialog` | Accept or dismiss an `alert` / `confirm` / `prompt` |
| `browser_wait_for` | Wait for text to appear or disappear, or for some seconds |
| `browser_screenshot` | Viewport (in CSS pixels, so `x`/`y` work with click), full page, or one element. `annotate: true` labels every ref on the image |
| `browser_console` | Console messages and uncaught errors, incrementally via `since` |
| `browser_network` | Requests with method, status, type, duration and size, incrementally via `since` |
| `browser_tabs`, `browser_tab_new`, `browser_tab_select`, `browser_tab_close` | Work with several shared tabs; actions go to the active one |
| `browser_evaluate` | Run JavaScript in the page. **Off by default**; enable `haiBrowser.allowEvaluate` |
| `browser_get_selection` | The element you picked: source `file:line:col`, selector, text, HTML, key styles, a ref, and a screenshot. `wait: true` asks you to pick one now (waits up to 5 minutes) |

Every action (`click`, `hover`, `scroll`, `drag`, `type`, `press_key`, `select_option`, `upload_file`, `handle_dialog`, `wait_for`) returns the page snapshot afterwards, like a computer-use agent seeing the screen after each step. Pass `screenshot: true` to also get an image, or `snapshot: false` to skip the outline. While the agent works, a purple **H/Ai** pointer glides to each spot it clicks, hovers, drags or types into, with a ripple on each click, so you can follow along. It never receives events, is left out of snapshots and is hidden from the agent's screenshots; turn it off with `haiBrowser.showAgentCursor`. If an action opens a JavaScript dialog, the result says so and other tools refuse to run until `browser_handle_dialog` handles it.

Tabs are the ones shared with agents (opened by `browser_open`/`browser_tab_new`, or shared by you). VS Code's browser-tab API is still proposed, so agents can't see or switch to your other tabs until you share them.

## Security

- The agent API listens on `127.0.0.1` only and rejects connections without the per-window token.
- Snapshots and picked-element HTML never include password values or `autocomplete="cc-*"` fields.
- Arbitrary JavaScript (`browser_evaluate`) is disabled unless you turn it on.
- Page content is untrusted: a web page can contain text written to manipulate an agent (prompt injection). Share tabs you trust, and prefer a separate profile for anything sensitive.
- The status bar shows **H/Ai: sharing** whenever a tab is shared; click it to stop.

## Development

```sh
pnpm typecheck && pnpm build && pnpm test
python3 -m http.server 8765 -d examples/demo   # demo page
pnpm smoke                                     # drives the demo through the MCP server (needs VS Code + extension running)

pnpm --filter example-vite-react dev           # React demo tagged by hai-browser-vite, on :5173
node packages/mcp/scripts/computer-smoke.mjs http://127.0.0.1:8765/ /abs/path/in/workspace.txt   # hover, drag, dialogs, uploads, tabs…
pnpm --filter hai-browser-mcp smoke:pick       # agent asks for a pick, checks it maps to src/PlanCard.tsx

pnpm --filter example-next-app dev             # Next.js demo (Turbopack) on :3000; or dev:webpack (webpack, :3001), one at a time
HAI_PICK_APP=next pnpm --filter hai-browser-mcp smoke:pick   # same check against app/Counter.tsx
```

Packages:

- `packages/extension` — VS Code extension (browser bridge + agent API)
- `packages/mcp` — `hai-browser-mcp` stdio MCP server
- `packages/vite-plugin` — `hai-browser-vite`, dev-only `data-hai-src` tagging
- `packages/next-plugin` — `hai-browser-next`, the same tagging for Next.js (Turbopack and webpack)
- `packages/protocol` — shared types for the extension ↔ MCP protocol
- `examples/demo`, `examples/vite-react`, `examples/next-app` — test pages

## License

MIT
