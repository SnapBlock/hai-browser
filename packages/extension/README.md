# H/Ai Browser

Share VS Code's integrated browser with Claude Code and other MCP agents, and pick an element on the page to jump to the JSX line that rendered it.

## Setup

1. Install this extension (VS Code 1.119+). Trust the workspace; the extension does not run in Restricted Mode.
2. Register the MCP server with your agent, e.g. `claude mcp add hai-browser -- npx -y hai-browser-mcp`.
3. Run **H/Ai: Share Browser Tab with Agent**, or let the agent open a page with `browser_open`.
4. For click-to-source, add `hai-browser-vite` or `hai-browser-next` to your dev server.

Everything runs locally: the agent API binds to `127.0.0.1` with a per-window token. `browser_evaluate` is off unless you enable `haiBrowser.allowEvaluate`.

See https://github.com/SnapBlock/hai-browser for details.
