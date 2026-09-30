# H/Ai — hai-browser

Share VS Code's integrated browser with **Claude Code** (or any MCP agent). You and the agent work in the same browser tab: it reads the page, clicks and types with real input, takes screenshots and watches the console, while you watch and take over at any time.

> Status: **phase 0 prototype**. Element → source-line mapping (`data-hai-src`) is the next milestone; see [docs/plan.md](docs/plan.md).

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

## Security

- The agent API listens on `127.0.0.1` only and rejects connections without the per-window token.
- Snapshots never include password values or `autocomplete="cc-*"` fields.
- Arbitrary JavaScript (`browser_evaluate`) is disabled unless you turn it on.
- Page content is untrusted: a web page can contain text written to manipulate an agent (prompt injection). Share tabs you trust, and prefer a separate profile for anything sensitive.
- The status bar shows **H/Ai: sharing** whenever a tab is shared; click it to stop.

## Development

```sh
pnpm typecheck && pnpm build && pnpm test
python3 -m http.server 8765 -d examples/demo   # demo page
pnpm smoke                                     # drives the demo through the MCP server (needs VS Code + extension running)
```

Packages:

- `packages/extension` — VS Code extension (browser bridge + agent API)
- `packages/mcp` — `hai-browser-mcp` stdio MCP server
- `packages/protocol` — shared types for the extension ↔ MCP protocol

## License

MIT
