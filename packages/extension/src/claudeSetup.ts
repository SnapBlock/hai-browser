import { execFile } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';

const SERVER_NAME = 'hai-browser';
const OFFERED_KEY = 'haiBrowser.claudeConnectOffered';
const isWindows = process.platform === 'win32';

interface ServerCommand {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/** Copy the bundled MCP server to ~/.hai-browser/mcp so agent configs keep working across extension updates. */
export async function installServer(context: vscode.ExtensionContext): Promise<string> {
  const dir = join(homedir(), '.hai-browser', 'mcp');
  const dest = join(dir, 'index.mjs');
  const bundled = await readFile(context.asAbsolutePath('dist/mcp.mjs'));
  const current = await readFile(dest).catch(() => undefined);
  if (!current?.equals(bundled)) {
    await mkdir(dir, { recursive: true });
    const tmp = `${dest}.${process.pid}.tmp`;
    await writeFile(tmp, bundled);
    await rename(tmp, dest);
  }
  return dest;
}

/** Prefer a Node.js 20+ on PATH; otherwise run the server with VS Code's own runtime. */
export async function serverCommand(serverPath: string): Promise<ServerCommand> {
  const node = await run('node', ['--version']);
  const major = Number(/^v(\d+)/.exec(node.stdout.trim())?.[1]);
  if (node.ok && major >= 20) return { command: 'node', args: [serverPath], env: {} };
  return { command: process.execPath, args: [serverPath], env: { ELECTRON_RUN_AS_NODE: '1' } };
}

export function addCommandLine(cmd: ServerCommand): string {
  const env = Object.entries(cmd.env).map(([k, v]) => ` -e ${k}=${v}`).join('');
  return ['claude', 'mcp', 'add', '--scope', 'user', SERVER_NAME].join(' ') + env + ' -- ' + [cmd.command, ...cmd.args].map(quote).join(' ');
}

/** Register the MCP server with Claude Code (user scope), replacing any earlier H/Ai entry. */
export async function connectClaude(context: vscode.ExtensionContext, log: vscode.LogOutputChannel): Promise<void> {
  await context.globalState.update(OFFERED_KEY, true);
  const cmd = await serverCommand(await installServer(context));
  const claude = await findClaude();
  if (!claude) {
    const terminal = vscode.window.createTerminal('H/Ai: Connect Claude Code');
    terminal.show();
    terminal.sendText(addCommandLine(cmd));
    vscode.window.showInformationMessage(
      'H/Ai: could not find the claude command from VS Code, so the setup command was sent to a terminal.',
    );
    return;
  }
  await run(claude, ['mcp', 'remove', '--scope', 'user', SERVER_NAME]);
  const env = Object.entries(cmd.env).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
  const added = await run(claude, ['mcp', 'add', '--scope', 'user', SERVER_NAME, ...env, '--', cmd.command, ...cmd.args]);
  log.info(`${claude} mcp add: ${(added.stdout + added.stderr).trim()}`);
  if (!added.ok) {
    vscode.window.showWarningMessage(`H/Ai: connecting Claude Code failed: ${(added.stderr || added.stdout).trim()}`);
    return;
  }
  vscode.window.showInformationMessage(
    'H/Ai is connected to Claude Code. Start (or restart) claude in this workspace and ask it to open a page.',
  );
}

/** On first run, offer to connect Claude Code unless H/Ai is already registered with it. */
export async function offerClaudeConnect(context: vscode.ExtensionContext, log: vscode.LogOutputChannel): Promise<void> {
  if (context.globalState.get(OFFERED_KEY)) return;
  const claude = await findClaude();
  log.info(claude ? `Claude Code CLI: ${claude}` : 'Claude Code CLI not found on PATH');
  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? homedir();
  if (claude && (await run(claude, ['mcp', 'get', SERVER_NAME], cwd)).ok) {
    await context.globalState.update(OFFERED_KEY, true);
    return;
  }
  const pick = await vscode.window.showInformationMessage(
    'H/Ai: let Claude Code use this browser?',
    'Connect Claude Code',
    'Not now',
  );
  if (pick === 'Connect Claude Code') await connectClaude(context, log);
  else await context.globalState.update(OFFERED_KEY, true);
}

async function findClaude(): Promise<string | undefined> {
  const exe = isWindows ? 'claude.exe' : 'claude';
  const home = homedir();
  for (const candidate of ['claude', join(home, '.local', 'bin', exe), join(home, '.claude', 'local', exe)]) {
    if ((await run(candidate, ['--version'])).ok) return candidate;
  }
  if (isWindows) return undefined;
  // VS Code may be started without the login shell's PATH (e.g. nvm installs), so ask that shell.
  const viaShell = await run(process.env.SHELL || '/bin/sh', ['-ilc', 'command -v claude']);
  const found = viaShell.stdout.trim().split('\n').pop()?.trim();
  return viaShell.ok && found?.startsWith('/') ? found : undefined;
}

function run(file: string, args: string[], cwd = homedir()): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  // npm installs claude as a .cmd shim on Windows, which needs a shell; quote args ourselves there.
  const shell = isWindows && !/[\\/]/.test(file);
  return new Promise(resolve => {
    execFile(
      shell ? quote(file) : file,
      shell ? args.map(quote) : args,
      { cwd, shell, timeout: 30_000, windowsHide: true },
      (err, stdout, stderr) => resolve({ ok: !err, stdout: String(stdout), stderr: String(stderr) }),
    );
  });
}

function quote(arg: string): string {
  if (/^[\w@%+=:,./\\-]+$/.test(arg)) return arg;
  return isWindows ? `"${arg.replace(/"/g, '""')}"` : `'${arg.replace(/'/g, `'\\''`)}'`;
}
