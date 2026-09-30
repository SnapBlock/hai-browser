// End-to-end smoke test: drives the shared browser through the MCP server exactly as an agent would.
// Usage: node scripts/smoke.mjs <url>   (VS Code with the extension must be running)
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { writeFileSync } from 'node:fs';

const url = process.argv[2] ?? 'http://127.0.0.1:8765/';
const client = new Client({ name: 'hai-smoke', version: '0.0.0' });
await client.connect(new StdioClientTransport({ command: 'node', args: [new URL('../dist/index.js', import.meta.url).pathname] }));

const call = async (name, args = {}) => {
  const res = await client.callTool({ name, arguments: args });
  const out = res.content.map(c => (c.type === 'text' ? c.text : `[${c.type} ${c.mimeType} ${c.data.length} b64 chars]`)).join('\n');
  console.log(`\n=== ${name} ${JSON.stringify(args)}${res.isError ? ' (ERROR)' : ''}\n${out}`);
  return res;
};

console.log('tools:', (await client.listTools()).tools.map(t => t.name).join(', '));
await call('browser_open', { url });
const snap = await call('browser_snapshot');
const tree = snap.content[0].text;
const ref = label => tree.match(new RegExp(`${label}.*?\\[ref=(e\\d+)\\]`))?.[1];
await call('browser_click', { ref: ref('"Increment"') });
await call('browser_click', { ref: ref('"Increment"') });
await call('browser_type', { ref: ref('"Email"'), text: 'festus@example.com' });
await call('browser_type', { ref: ref('"Password"'), text: 'hunter2' });
await call('browser_click', { ref: ref('checkbox') });
await call('browser_click', { ref: ref('"Sign up"') });
await call('browser_snapshot');
await call('browser_console');
const shot = await call('browser_screenshot');
if (shot.content[0]?.type === 'image') writeFileSync('/tmp/hai-smoke.png', Buffer.from(shot.content[0].data, 'base64'));
await call('browser_evaluate', { expression: '1 + 1' });
await call('browser_navigate', { action: 'reload' });
await call('browser_status');
await client.close();
