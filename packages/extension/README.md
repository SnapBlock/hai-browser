# H/Ai Browser

Share VS Code's integrated browser with Claude Code, GitHub Copilot, Codex CLI, Gemini CLI, Cline and other MCP agents, and pick an element on the page to jump to the JSX line that rendered it.

## Setup

1. Install this extension (VS Code 1.119+, VSCodium or Windsurf; not Cursor or Antigravity yet). Trust the workspace; the extension does not run in Restricted Mode.
2. Click **Connect Claude Code** when H/Ai asks (or run **H/Ai: Connect Claude Code**). The MCP server ships inside the extension. GitHub Copilot in VS Code picks it up with no setup; for Codex CLI, Gemini CLI, Cline and others, run **H/Ai: Connect Other Agents** to copy their setup.
3. Start `claude` in your workspace and ask it to open a page, or run **H/Ai: Share Browser Tab with Agent**.
4. For click-to-source, install the dev plugin for your framework: `npm install -D hai-browser-vite` (add `hai()` to `vite.config.ts`) or `npm install -D hai-browser-next` (wrap `next.config` in `withHaiBrowser(...)`).

Everything runs locally: the agent API binds to `127.0.0.1` with a per-window token. `browser_evaluate` is off unless you enable `haiBrowser.allowEvaluate`.

See https://github.com/SnapBlock/hai-browser for details.
