// Checks that the tabs an agent opened close when it disconnects, unless the user clicked in them.
// Usage: node scripts/keep-smoke.mjs <url>   (needs VS Code with the extension on $DISPLAY, and xdotool)
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { execSync } from 'node:child_process';

const url = process.argv[2] ?? 'http://127.0.0.1:8799/';
// Unique addresses, so browser_open never attaches to a tab an earlier run left open.
const run = n => `${url}?run=${Date.now()}-${n}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const connect = async () => {
  const client = new Client({ name: 'hai-keep-smoke', version: '0.0.0' });
  await client.connect(new StdioClientTransport({ command: 'node', args: [new URL('../dist/index.js', import.meta.url).pathname] }));
  const call = async (name, args = {}) => {
    const res = await client.callTool({ name, arguments: args });
    const out = res.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
    console.log(`=== ${name} ${JSON.stringify(args)}\n${out.split('\n').slice(0, 4).join('\n')}`);
    return out;
  };
  return { client, call };
};
const check = (ok, what) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${what}`);
  if (!ok) process.exitCode = 1;
};
// A real X click low in the VS Code window, on the browser page.
const userClick = () => {
  const id = execSync('xdotool search --onlyvisible --name "Visual Studio Code" | tail -1').toString().trim();
  const geo = execSync(`xdotool getwindowgeometry --shell ${id}`).toString();
  const n = k => Number(new RegExp(`${k}=(\\d+)`).exec(geo)[1]);
  execSync(`xdotool mousemove ${Math.round(n('X') + n('WIDTH') / 2)} ${Math.round(n('Y') + n('HEIGHT') * 0.75)} click 1`);
};
const others = out => Number(/(\d+) other browser tab/i.exec(out)?.[1] ?? 0);

// 1. The agent's own clicks and typing don't count as the user's.
let a = await connect();
await a.call('browser_open', { url: run(1) });
const ref = (await a.call('browser_snapshot')).match(/"Live filter".*?\[ref=(e\d+)\]/)?.[1];
await a.call('browser_click', { ref });
await a.call('browser_type', { ref, text: 'mugs', submit: true });
await a.client.close();
await sleep(3000);
let b = await connect();
let out = await b.call('browser_tabs');
const before = others(out);
check(!/run=\d+-1/.test(out), 'a tab the agent only used itself is closed on disconnect');
await b.client.close();

// 2. A tab the user clicked in stays open.
a = await connect();
await a.call('browser_open', { url: run(2) });
await sleep(1000);
userClick();
await sleep(2500);
await a.client.close();
await sleep(3000);
b = await connect();
out = await b.call('browser_tabs');
check(!/run=\d+-2/.test(out) && others(out) === before + 1, 'a tab the user clicked in is no longer shared but stays open');

// 3. browser_tab_close on a tab the user clicked in only stops sharing it.
await b.call('browser_tab_new', { url: run(3) });
await sleep(1000);
userClick();
await sleep(2500);
out = await b.call('browser_tab_close');
check(out.includes('stays open for them'), 'browser_tab_close keeps a tab the user used open');
await b.client.close();
