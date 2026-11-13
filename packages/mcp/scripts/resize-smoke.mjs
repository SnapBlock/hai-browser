// Checks that agent steps and screenshots never resize the live page (it shows as a flicker on HiDPI screens).
// Usage: node scripts/resize-smoke.mjs <url of a page with "Top one"/"Top two" buttons that logs "hai-resize" on resize>
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const url = `${process.argv[2] ?? 'http://127.0.0.1:8799/resize.html'}?run=${Date.now()}`;
const client = new Client({ name: 'hai-resize-smoke', version: '0.0.0' });
await client.connect(new StdioClientTransport({ command: 'node', args: [new URL('../dist/index.js', import.meta.url).pathname] }));
const t0 = Number(process.env.T0 || Date.now());
const call = async (name, args = {}) => {
  if (process.env.T0) console.log(`   t=${((Date.now() - t0) / 1000).toFixed(2)} ${name}`);
  const res = await client.callTool({ name, arguments: args });
  return res.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
};
const check = (ok, what) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${what}`);
  if (!ok) process.exitCode = 1;
};
let seen = 0;
const resizes = async () => {
  const log = await call('browser_console');
  const all = log.match(/hai-resize[^\n"]*/g) ?? [];
  const n = all.slice(seen);
  seen = all.length;
  if (n.length) console.log('  ', n.join(' | '));
  return n.length;
};

await call('browser_open', { url });
await new Promise(r => setTimeout(r, 1000));
await resizes();
const snap = await call('browser_snapshot');
const ref = name => new RegExp(`"${name}".*?\\[ref=(e\\d+)\\]`).exec(snap)?.[1];
await call('browser_click', { ref: ref('Top one') });
await call('browser_click', { ref: ref('Top two') });
check((await resizes()) === 0, 'recorded steps never resize the page');
await call('browser_screenshot');
check((await resizes()) === 0, 'a viewport screenshot never resizes the page');
await call('browser_screenshot', { ref: ref('Top two') });
check((await resizes()) === 0, 'an element screenshot never resizes the page');
const shot = await client.callTool({ name: 'browser_screenshot', arguments: {} });
const img = shot.content.find(c => c.type === 'image');
if (img) {
  const b = Buffer.from(img.data, 'base64');
  console.log('   screenshot px', b.readUInt32BE(16), 'x', b.readUInt32BE(20));
}
console.log((await call('browser_console')).match(/hai-start[^\n"]*/)?.[0]);
await client.close();
