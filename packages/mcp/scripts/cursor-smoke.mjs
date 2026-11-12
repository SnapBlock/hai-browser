// Checks that screenshots only hide the agent cursor when it is in the picture, so it doesn't flicker.
// Usage: node scripts/cursor-smoke.mjs <url of a page with "Top one", "Top two" and "Far corner" buttons that logs
// "hai-hidden" to the console when #__hai_cursor gets display:none>   (needs VS Code with the extension on $DISPLAY)
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const url = `${process.argv[2] ?? 'http://127.0.0.1:8799/cursor.html'}?run=${Date.now()}`;
const client = new Client({ name: 'hai-cursor-smoke', version: '0.0.0' });
await client.connect(new StdioClientTransport({ command: 'node', args: [new URL('../dist/index.js', import.meta.url).pathname] }));
const call = async (name, args = {}) => {
  const res = await client.callTool({ name, arguments: args });
  return res.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
};
const check = (ok, what) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${what}`);
  if (!ok) process.exitCode = 1;
};
let seen = 0;
const hides = async () => {
  const all = (await call('browser_console')).match(/hai-hidden/g)?.length ?? 0;
  const n = all - seen;
  seen = all;
  return n;
};

await call('browser_open', { url });
const snap = await call('browser_snapshot');
const ref = name => new RegExp(`"${name}".*?\\[ref=(e\\d+)\\]`).exec(snap)?.[1];
await call('browser_click', { ref: ref('Top one') });
await call('browser_click', { ref: ref('Top two') });
await call('browser_hover', { ref: ref('Top one') });
check((await hides()) === 0, 'recorded steps never hide the cursor');
await call('browser_screenshot', { ref: ref('Far corner') });
check((await hides()) === 0, 'a screenshot of an element away from the cursor keeps it');
await call('browser_screenshot');
check((await hides()) === 1, 'a screenshot of the page with the cursor in it hides it once');
const states = (await call('browser_console')).match(/hai-(?:shown|hidden)/g) ?? [];
check(states.at(-1) === 'hai-shown', 'the cursor comes back after the screenshot');
await client.close();
