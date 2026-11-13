// Checks that browser_type replaces the text of contenteditable fields, not just inputs.
// Usage: node scripts/editable-smoke.mjs <url of a page with "Plain editable" and "Nested editable" contenteditable
// textboxes, a "Normal input" and an "Email" input holding "a@gmail.com", that logs "VALUES {plain, nested, inp, email}" on input>   (needs VS Code with the extension)
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const url = `${process.argv[2] ?? 'http://127.0.0.1:8799/editable.html'}?run=${Date.now()}`;
const client = new Client({ name: 'hai-editable-smoke', version: '0.0.0' });
await client.connect(new StdioClientTransport({ command: 'node', args: [new URL('../dist/index.js', import.meta.url).pathname] }));
const call = async (name, args = {}) => {
  const res = await client.callTool({ name, arguments: args });
  return res.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
};
const check = (ok, what) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${what}`);
  if (!ok) process.exitCode = 1;
};
const values = async () => JSON.parse([...(await call('browser_console')).matchAll(/VALUES (\{.*?\})\s/g)].at(-1)?.[1] ?? '{}');

await call('browser_open', { url });
const snap = await call('browser_snapshot');
const ref = name => new RegExp(`"${name}".*?\\[ref=(e\\d+)\\]`).exec(snap)?.[1];
await call('browser_type', { ref: ref('Plain editable'), text: '2' });
check((await values()).plain === '2', 'typing into a contenteditable replaces its text');
await call('browser_type', { ref: ref('Nested editable'), text: 'new' });
check((await values()).nested === 'new', 'typing into a contenteditable with nested markup replaces all of it');
await call('browser_type', { ref: ref('Normal input'), text: '7' });
check((await values()).inp === '7', 'typing into an input still replaces its value');
await call('browser_type', { ref: ref('Plain editable'), text: '3', clear: false });
check((await values()).plain === '23', 'clear: false still appends');
await call('browser_click', { ref: ref('Email') });
await call('browser_press_key', { key: 'End' });
for (let i = 0; i < 4; i++) await call('browser_press_key', { key: 'Shift+ArrowLeft' });
await call('browser_type', { ref: ref('Email'), text: '.io', selection: true });
check((await values()).email === 'a@gmail.io', 'selection: true types over the selected text only');
await call('browser_press_key', { key: 'Home' });
await call('browser_type', { ref: ref('Email'), text: 'x', selection: true });
check((await values()).email === 'xa@gmail.io', 'selection: true types at the caret when nothing is selected');
await call('browser_click', { ref: ref('Plain editable') });
await call('browser_press_key', { key: 'End' });
await call('browser_press_key', { key: 'Shift+ArrowLeft' });
await call('browser_type', { ref: ref('Plain editable'), text: '9', selection: true });
check((await values()).plain === '29', 'selection: true works in a contenteditable');
await client.close();
