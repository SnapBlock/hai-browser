import * as vscode from 'vscode';
import type { AgentMethods, AgentRequest } from '@hai-browser/protocol';
import { AgentServer } from './agentServer';
import { BrowserBridge } from './browser';

const MCP_ADD_COMMAND = 'claude mcp add hai-browser -- npx -y hai-browser-mcp';

export async function activate(context: vscode.ExtensionContext) {
  const bridge = new BrowserBridge();
  const log = vscode.window.createOutputChannel('H/Ai Browser', { log: true });
  const server = new AgentServer(req => {
    log.info(`agent → ${req.method}`);
    return dispatch(bridge, req);
  });

  const folders = () => (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath);
  const port = await server.start(folders());
  log.info(`Agent API listening on 127.0.0.1:${port} (lockfile ${server.lockfilePath})`);

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  const renderStatus = (shared: boolean) => {
    status.text = shared ? '$(globe) H/Ai: sharing' : '$(globe) H/Ai';
    status.tooltip = shared ? 'A browser tab is shared with agents. Click to stop sharing.' : 'Share a browser tab with agents';
    status.command = shared ? 'haiBrowser.stopSharing' : 'haiBrowser.share';
    status.backgroundColor = shared ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
  };
  renderStatus(false);
  status.show();

  context.subscriptions.push(
    bridge,
    log,
    status,
    { dispose: () => server.dispose() },
    bridge.onDidChangeShared(renderStatus),
    vscode.workspace.onDidChangeWorkspaceFolders(() => server.updateWorkspaceFolders(folders())),
    vscode.commands.registerCommand('haiBrowser.share', async () => {
      try {
        const s = await bridge.share();
        vscode.window.showInformationMessage(`H/Ai: sharing ${s.title || s.url} with agents.`);
      } catch (e) {
        vscode.window.showWarningMessage(`H/Ai: ${e instanceof Error ? e.message : e}`);
      }
    }),
    vscode.commands.registerCommand('haiBrowser.stopSharing', () => bridge.stop()),
    vscode.commands.registerCommand('haiBrowser.showConnectionInfo', async () => {
      const pick = await vscode.window.showInformationMessage(
        `Connect Claude Code with: ${MCP_ADD_COMMAND}`,
        'Copy command',
      );
      if (pick) await vscode.env.clipboard.writeText(MCP_ADD_COMMAND);
    }),
  );
}

export function deactivate() {}

async function dispatch(bridge: BrowserBridge, req: AgentRequest): Promise<unknown> {
  const p = req.params as any;
  switch (req.method as keyof AgentMethods) {
    case 'status':
      return bridge.status();
    case 'share':
      return bridge.share();
    case 'open':
      return bridge.open(requireString(p.url, 'url'));
    case 'navigate':
      return bridge.navigate(p);
    case 'snapshot':
      return bridge.snapshot();
    case 'click':
      return bridge.click(requireString(p.ref, 'ref'));
    case 'type':
      return bridge.type(requireString(p.ref, 'ref'), String(p.text ?? ''), p.clear ?? true, p.submit ?? false);
    case 'press':
      return bridge.press(requireString(p.key, 'key'));
    case 'screenshot':
      return bridge.screenshot(p.ref, p.fullPage);
    case 'console':
      return bridge.console(p.since, p.limit);
    case 'evaluate':
      if (!vscode.workspace.getConfiguration('haiBrowser').get<boolean>('allowEvaluate')) {
        throw new Error('browser_evaluate is disabled. The user can enable the "haiBrowser.allowEvaluate" setting.');
      }
      return { value: await bridge.evaluate(requireString(p.expression, 'expression')) };
    default:
      throw new Error(`Unknown method: ${req.method}`);
  }
}

function requireString(v: unknown, name: string): string {
  if (typeof v !== 'string' || !v) throw new Error(`"${name}" is required.`);
  return v;
}
