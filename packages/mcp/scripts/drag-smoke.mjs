// Repeats a ref-to-ref drag on the demo slider and checks it lands at 50%. Usage: node scripts/drag-smoke.mjs [runs]
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const client = new Client({ name: 'drag-smoke', version: '0' });
await client.connect(new StdioClientTransport({ command: 'node', args: [new URL('../dist/index.js', import.meta.url).pathname] }));
const text = r => r.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
const ref = (t, label) => t.match(new RegExp(label + '[^\\n]*\\[ref=(e\\d+)\\]'))?.[1];
let ok = 0;
const n = Number(process.argv[2] ?? 5);
for (let i = 0; i < n; i++) {
  await client.callTool({ name: 'browser_open', arguments: { url: 'http://127.0.0.1:8765/index.html' } });
  await client.callTool({ name: 'browser_navigate', arguments: { action: 'reload' } });
  const t = text(await client.callTool({ name: 'browser_snapshot', arguments: {} }));
  const r = text(await client.callTool({ name: 'browser_drag', arguments: { fromRef: ref(t, '"Knob"'), toRef: ref(t, '"Slider midpoint"') } }));
  const m = r.match(/Slider: (\d+)%/);
  console.log(i, m ? m[0] : 'no log');
  if (m && +m[1] >= 40 && +m[1] <= 60) ok++;
}
console.log(`${ok}/${n} drags landed`);
await client.close();
