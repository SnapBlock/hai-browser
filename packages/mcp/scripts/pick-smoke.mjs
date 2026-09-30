// Phase 1 smoke test: an agent asks the user to pick an element, and gets its source location back.
// Usage: node scripts/pick-smoke.mjs <url>   (VS Code with the extension and a hai-browser-vite dev server running)
// The "user" click is simulated with browser_click while the picker is active; set HAI_PICK_MANUAL=1 to click yourself.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const url = process.argv[2] ?? 'http://127.0.0.1:5173/';
const pause = Number(process.env.HAI_SMOKE_DELAY ?? 0);
const client = new Client({ name: 'hai-pick-smoke', version: '0.0.0' });
await client.connect(new StdioClientTransport({ command: 'node', args: [new URL('../dist/index.js', import.meta.url).pathname] }));

const call = async (name, args = {}) => {
  if (pause) await new Promise(r => setTimeout(r, pause));
  const res = await client.callTool({ name, arguments: args }, undefined, { timeout: 180_000 });
  const out = res.content.map(c => (c.type === 'text' ? c.text : `[${c.type} ${c.mimeType} ${c.data.length} b64 chars]`)).join('\n');
  console.log(`\n=== ${name} ${JSON.stringify(args)}${res.isError ? ' (ERROR)' : ''}\n${out}`);
  return res;
};
const textOf = res => res.content.find(c => c.type === 'text')?.text ?? '';

await call('browser_open', { url });
const tree = textOf(await call('browser_snapshot'));
const pro = tree.match(/"Choose Pro" \[ref=(e\d+)\]/)?.[1];
if (!pro) throw new Error('Could not find the "Choose Pro" button in the snapshot');

const picked = call('browser_get_selection', { wait: true, timeoutSeconds: 120 });
if (!process.env.HAI_PICK_MANUAL) {
  await new Promise(r => setTimeout(r, Math.max(pause, 1500)));
  await call('browser_click', { ref: pro });
}
const selection = textOf(await picked);
await call('browser_get_selection');
const after = textOf(await call('browser_snapshot'));

const checks = {
  'source points at PlanCard.tsx': /Source: .*src\/PlanCard\.tsx:\d+:\d+/.test(selection),
  'picked the button': /Picked <button>/.test(selection),
  'click was captured, not delivered to the page': after.includes('No plan chosen yet'),
};
console.log('\n=== checks');
for (const [name, ok] of Object.entries(checks)) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
await client.close();
process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
