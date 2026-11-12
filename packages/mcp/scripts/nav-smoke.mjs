// Checks that a key press that changes nothing is reported, and that an agent's tabs close when it disconnects.
// Usage: node scripts/nav-smoke.mjs <url of a page with "Dead search", "Real search" and "Live filter" inputs>
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const url = process.argv[2] ?? 'http://127.0.0.1:8799/';
const connect = async () => {
  const client = new Client({ name: 'hai-nav-smoke', version: '0.0.0' });
  await client.connect(new StdioClientTransport({ command: 'node', args: [new URL('../dist/index.js', import.meta.url).pathname] }));
  return client;
};
const caller = client => async (name, args = {}) => {
  const res = await client.callTool({ name, arguments: args });
  const out = res.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
  console.log(`\n=== ${name} ${JSON.stringify(args)}${res.isError ? ' (ERROR)' : ''}\n${out.split('\n').slice(0, 6).join('\n')}`);
  return out;
};
const check = (ok, what) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${what}`);
  if (!ok) process.exitCode = 1;
};

const agent = await connect();
const call = caller(agent);
const instructions = agent.getInstructions() ?? '';
check(instructions.includes('never type a URL into a search box'), 'instructions say to open URLs with browser_open');
await call('browser_open', { url });
const ref = async label => (await call('browser_snapshot')).match(new RegExp(`"${label}".*?\\[ref=(e\\d+)\\]`))?.[1];
const unchanged = 'neither the URL nor the page changed';

let out = await call('browser_type', { ref: await ref('Dead search'), text: 'http://127.0.0.1:8799/results.html', submit: true });
check(out.includes(unchanged), 'Enter on a search box that ignores it is reported as no change');
out = await call('browser_press_key', { key: 'Enter' });
check(out.includes(unchanged), 'browser_press_key Enter that does nothing is reported');
out = await call('browser_type', { ref: await ref('Live filter'), text: 'mugs', submit: true });
check(!out.includes(unchanged) && out.includes('Results for mugs'), 'debounced input gets the text before Enter');
out = await call('browser_type', { ref: await ref('Real search'), text: 'mugs', submit: true });
check(!out.includes(unchanged) && out.includes('results.html?q=mugs'), 'Enter that submits a form is not reported as no change');
out = await call('browser_tabs');
check(out.includes('(opened by you)'), 'browser_tabs marks the tab the agent opened');
await agent.close();

await new Promise(r => setTimeout(r, 3000));
const next = await connect();
out = await caller(next)('browser_tabs');
check(!out.includes('results.html'), 'the tab closed when the agent disconnected');
await next.close();
