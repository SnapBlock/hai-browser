# H/Ai — hai-browser

Share VS Code's integrated browser with **Claude Code** (or any MCP agent). You and the agent work in the same browser tab: it reads the page, clicks and types with real input, takes screenshots and watches the console, while you watch and take over at any time.

Point at an element and H/Ai opens the line of code that rendered it, and the agent gets the same element (source location, HTML, styles, screenshot), so *"make this button match the header"* just works.

> Status: **prototype** (phases 0–1). See [docs/plan.md](docs/plan.md).

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

- VS Code **1.119+** (integrated browser + built-in JavaScript debugger)
- Node.js **20+**

## Setup (from source, until published)

```sh
pnpm install
pnpm build
```

1. Open this repo in VS Code and press **F5** ("Run hai-browser extension"), or install the packaged VSIX (`pnpm --filter hai-browser package`).
2. Register the MCP server with Claude Code:

   ```sh
   claude mcp add hai-browser -- node /path/to/hai-browser/packages/mcp/dist/index.js
   # once published: claude mcp add hai-browser -- npx -y hai-browser-mcp
   ```

3. Ask Claude to open your app, e.g. *"open http://localhost:5173 and check the signup form works"*. Or share a tab you already have open with **H/Ai: Share Browser Tab with Agent** (also in the status bar).

## Jump from the page to the code

Add the dev-only Vite plugin (React/JSX; production builds are untouched):

```ts
// vite.config.ts
import react from '@vitejs/plugin-react';
import hai from 'hai-browser-vite';

export default defineConfig({ plugins: [hai(), react()] });
```

It tags each HTML element with where it was written, e.g. `<button data-hai-src="src/PlanCard.tsx:6:7">`. Components are not tagged themselves (they may not pass unknown props to the DOM), so you land on the JSX element inside the component.

Then run **H/Ai: Pick Element and Open Source** (status bar **Pick** while a tab is shared), hover to highlight, and click. The click is captured rather than sent to the page, VS Code opens the file at that line beside the browser, and the element becomes the agent's current selection. Esc cancels.

Agents read it with `browser_get_selection`, or call it with `wait: true` to ask you to pick something. Snapshots also show `src=file:line:col` next to each tagged element.

## Tools

| Tool | What it does |
|---|---|
| `browser_status` | Whether a tab is shared, plus URL and title |
| `browser_open` | Open a URL in the shared tab (opens and shares a new tab if none) |
| `browser_request_share` | Ask the user to pick one of their open tabs to share |
| `browser_navigate` | Go to a URL, or back / forward / reload |
| `browser_snapshot` | Accessibility-style outline with `[ref=eN]` handles |
| `browser_click` | Click an element by ref (trusted mouse input) |
| `browser_type` | Type into an element by ref, optionally clear and submit |
| `browser_press_key` | Press a key (`Enter`, `Escape`, `ArrowDown`, `a`, …) |
| `browser_screenshot` | Viewport, full page, or one element |
| `browser_console` | Console messages and uncaught errors, incrementally via `since` |
| `browser_evaluate` | Run JavaScript in the page. **Off by default**; enable `haiBrowser.allowEvaluate` |
| `browser_get_selection` | The element you picked: source `file:line:col`, selector, text, HTML, key styles, a ref, and a screenshot. `wait: true` asks you to pick one now |

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
pnpm --filter hai-browser-mcp smoke:pick       # agent asks for a pick, checks it maps to src/PlanCard.tsx
```

Packages:

- `packages/extension` — VS Code extension (browser bridge + agent API)
- `packages/mcp` — `hai-browser-mcp` stdio MCP server
- `packages/vite-plugin` — `hai-browser-vite`, dev-only `data-hai-src` tagging
- `packages/protocol` — shared types for the extension ↔ MCP protocol
- `examples/demo`, `examples/vite-react` — test pages

## License

MIT
