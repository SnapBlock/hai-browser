// Smoke test for the computer-use style tools against examples/demo.
// Usage: node scripts/computer-smoke.mjs <demo url> <absolute path of a file inside the workspace>
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { writeFileSync } from 'node:fs';

const url = process.argv[2] ?? 'http://127.0.0.1:8765/';
const uploadPath = process.argv[3];
const client = new Client({ name: 'hai-computer-smoke', version: '0.0.0' });
await client.connect(new StdioClientTransport({ command: 'node', args: [new URL('../dist/index.js', import.meta.url).pathname] }));

const pause = Number(process.env.HAI_SMOKE_DELAY ?? 0);
let failures = 0;
let tree = '';
const call = async (name, args = {}, expect) => {
  if (pause) await new Promise(r => setTimeout(r, pause));
  const res = await client.callTool({ name, arguments: args });
  const texts = res.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
  const images = res.content.filter(c => c.type === 'image');
  if (texts.includes('[ref=')) tree = texts;
  const ok = !res.isError && (!expect || expect.test(texts));
  if (!ok) failures++;
  console.log(`\n=== ${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(args)}${images.length ? ` [+${images.length} image]` : ''}`);
  console.log(texts.split('\n').slice(0, ok ? 3 : 40).join('\n'));
  return res;
};
const expectError = async (name, args) => {
  const res = await call(name, args);
  if (res.isError) failures--, console.log('  (expected error)');
  else failures++;
};
const ref = label => tree.match(new RegExp(`${label}[^\\n]*?\\[ref=(e\\d+)\\]`))?.[1];

await call('browser_open', { url }, /URL:|shared/);
await call('browser_navigate', { action: 'reload' });
await call('browser_snapshot', {}, /Increment/);
await call('browser_click', { ref: ref('"Increment"') }, /"Clicks:"\n\s*- text: "1"/);
const shot = await call('browser_screenshot', { annotate: true }, /ref=e\d+/);
const img = shot.content.find(c => c.type === 'image');
if (img) writeFileSync('/tmp/hai-annotated.png', Buffer.from(img.data, 'base64'));
await call('browser_hover', { ref: ref('"Hover me"') }, /Hovered/);
await call('browser_click', { ref: ref('"Double-click me"'), doubleClick: true }, /Double-clicked/);
await call('browser_click', { ref: ref('"Double-click me"'), button: 'right' }, /Right-clicked/);
await call('browser_select_option', { ref: ref('combobox "Plan"'), values: ['Team'] }, /Plan: team/);
if (uploadPath) await call('browser_upload_file', { ref: ref('file-input'), paths: [uploadPath] }, /Attached: /);
await expectError('browser_upload_file', { ref: ref('file-input'), paths: ['/etc/passwd'] });
await call('browser_click', { ref: ref('"Delete account"') }, /confirm dialog is open/);
await expectError('browser_snapshot');
await call('browser_handle_dialog', { accept: false }, /Kept/);
await call('browser_click', { ref: ref('"Load data"'), snapshot: false });
await call('browser_wait_for', { text: 'Loaded (200)' }, /Loaded \(200\)/);
await call('browser_network', { filter: 'data=1' }, /GET .*data=1 → 200/);
await call('browser_drag', { fromRef: ref('"Knob"'), toRef: ref('"Slider midpoint"') }, /Slider: [4-5]\d%/);
await call('browser_scroll', { deltaY: 2000, screenshot: true }, /Bottom of the page/);
await call('browser_press_key', { key: 'Control+Home' });
await call('browser_tab_new', { url: url + '#second' }, /"tabs": 2/);
await call('browser_tabs', {}, /t\d+.*#second/);
await call('browser_tab_close', {}, /./);
await call('browser_status', {}, /"shared": true/);
console.log(`\n${failures ? `${failures} FAILURE(S)` : 'ALL PASSED'}`);
await client.close();
process.exit(failures ? 1 : 0);
