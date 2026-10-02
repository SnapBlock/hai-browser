# hai-browser-mcp

MCP server for [H/Ai Browser](https://marketplace.visualstudio.com/items?itemName=hai-browser.hai-browser). It lets Claude Code, Codex CLI, Gemini CLI, Cline and other MCP clients drive the browser tab you share from VS Code's Integrated Browser: snapshots, clicks, typing, forms, tabs, screenshots, console and network logs, and the element you picked.

It needs the H/Ai Browser extension running in VS Code. The extension already bundles this server and sets it up for you (**H/Ai: Connect Claude Code** / **H/Ai: Connect Other Agents**). Use this package if you prefer to configure your client yourself:

```sh
claude mcp add --scope user hai-browser -- npx -y hai-browser-mcp
```

```json
{ "mcpServers": { "hai-browser": { "command": "npx", "args": ["-y", "hai-browser-mcp"] } } }
```

See https://github.com/SnapBlock/hai-browser for details.

<!-- mcp-name: io.github.festuscharles-n/hai-browser -->
