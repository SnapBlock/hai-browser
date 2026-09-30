// Smoke test: an agent asks the user to pick an element, and gets its source location back.
// Usage: HAI_PICK_APP=vite|next node scripts/pick-smoke.mjs [url]
//   (VS Code with the extension running, plus examples/vite-react or examples/next-app on its dev server)
// The "user" click is simulated with browser_click while the picker is active; set HAI_PICK_MANUAL=1 to click yourself.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const presets = {
  vite: { url: 'http://127.0.0.1:5173/', button: 'Choose Pro', file: 'examples/vite-react/src/PlanCard.tsx', unchanged: /No plan chosen yet/ },
  next: { url: 'http://127.0.0.1:3000/', button: 'Increment', file: 'examples/next-app/app/Counter.tsx', unchanged: /"Client component count:"\s*- text: "0"/ },
};
const app = presets[process.env.HAI_PICK_APP ?? 'vite'];
if (!app) throw new Error(`HAI_PICK_APP must be one of ${Object.keys(presets).join(', ')}`);
const url = process.argv[2] ?? app.url;
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
const target = tree.match(new RegExp(`"${app.button}" \\[ref=(e\\d+)\\]`))?.[1];
if (!target) throw new Error(`Could not find the "${app.button}" button in the snapshot`);

const picked = call('browser_get_selection', { wait: true, timeoutSeconds: 120 });
if (!process.env.HAI_PICK_MANUAL) {
  await new Promise(r => setTimeout(r, Math.max(pause, 1500)));
  await call('browser_click', { ref: target });
}
const selection = textOf(await picked);
await call('browser_get_selection');
const after = textOf(await call('browser_snapshot'));
const consoleLog = textOf(await call('browser_console'));

const checks = {
  [`source points at ${app.file}`]: selection.includes(`Source: `) && new RegExp(`${app.file}:\\d+:\\d+`).test(selection),
  'picked the button': /Picked <button>/.test(selection),
  'click was captured, not delivered to the page': app.unchanged.test(after),
  'no hydration errors': !/hydrat/i.test(consoleLog),
};
console.log('\n=== checks');
for (const [name, ok] of Object.entries(checks)) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
await client.close();
process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
