import { isAbsolute, join, relative } from 'node:path';
import * as vscode from 'vscode';
import type { AgentMethods, AgentRequest, PickedElement } from '@hai-browser/protocol';
import { AgentServer } from './agentServer';
import { BrowserBridge } from './browser';
import { ActionGuard, type Risk } from './guard';
import { recordStep } from './recording';
import { agentName } from './replayHtml';
import { pickAndReplay } from './replayPanel';
import { RunRecorder } from './runRecorder';
import { agentSetups, connectClaude, installServer, offerClaudeConnect, registerVsCodeMcpServer, serverCommand } from './claudeSetup';

export async function activate(context: vscode.ExtensionContext) {
  const bridge = new BrowserBridge();
  const log = vscode.window.createOutputChannel('H/Ai Browser', { log: true });
  const recorder = new RunRecorder({ dir: join(context.globalStorageUri.fsPath, 'runs') });
  const replayItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 98);
  replayItem.text = '$(history) Replay';
  replayItem.tooltip = 'Replay an agent run step by step';
  replayItem.command = 'haiBrowser.replayRun';
  if (recorder.list().some(r => r.steps > 0)) replayItem.show();
  const guard = new ActionGuard();
  const server = new AgentServer(
    (req, connection) => {
      log.info(`agent → ${req.method}`);
      return recordStep(bridge, recorder, req, connection, () => guarded(bridge, guard, req, connection), () => replayItem.show(), log);
    },
    connection => {
      recorder.endConnection(connection);
      guard.end(connection);
    },
  );

  const folders = () => (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath);
  const port = await server.start(folders());
  log.info(`Agent API listening on 127.0.0.1:${port} (lockfile ${server.lockfilePath})`);

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  const renderStatus = (shared: boolean) => {
    const n = bridge.tabCount;
    status.text = shared ? `$(globe) H/Ai: sharing${n > 1 ? ` ${n} tabs` : ''}` : '$(globe) H/Ai';
    status.tooltip = shared ? 'A browser tab is shared with agents. Click to stop sharing.' : 'Share a browser tab with agents';
    status.command = shared ? 'haiBrowser.stopSharing' : 'haiBrowser.share';
    status.backgroundColor = shared ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
  };
  const pickItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
  pickItem.text = '$(inspect) Pick';
  pickItem.tooltip = 'Pick an element in the shared browser tab and open its source';
  pickItem.command = 'haiBrowser.pickElement';
  const renderAll = (shared: boolean) => {
    renderStatus(shared);
    if (shared) pickItem.show();
    else pickItem.hide();
  };
  renderAll(false);
  status.show();

  const pickElement = async () => {
    if (bridge.isPicking) return bridge.cancelPick();
    try {
      if (!bridge.shared) await bridge.share();
      const hint = vscode.window.setStatusBarMessage('$(inspect) H/Ai: click an element in the browser (Esc cancels)');
      await bridge.pick().finally(() => hint.dispose());
    } catch (e) {
      vscode.window.showWarningMessage(`H/Ai: ${e instanceof Error ? e.message : e}`);
    }
  };

  context.subscriptions.push(
    bridge,
    log,
    status,
    { dispose: () => server.dispose() },
    pickItem,
    bridge.onDidChangeShared(renderAll),
    bridge.onDidPick(el => openSource(el, log)),
    vscode.commands.registerCommand('haiBrowser.pickElement', pickElement),
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
    vscode.commands.registerCommand('haiBrowser.replayRun', () => pickAndReplay(recorder)),
    vscode.commands.registerCommand('haiBrowser.clearRuns', async () => {
      const ok = await vscode.window.showWarningMessage('Delete all recorded agent runs?', { modal: true }, 'Delete');
      if (ok !== 'Delete') return;
      recorder.clear();
      replayItem.hide();
    }),
    replayItem,
    vscode.commands.registerCommand('haiBrowser.connectClaude', () => connectClaude(context, log)),
    vscode.commands.registerCommand('haiBrowser.showConnectionInfo', async () => {
      const setups = agentSetups(await serverCommand(await installServer(context)));
      const pick = await vscode.window.showQuickPick(
        setups.map(setup => ({ label: setup.label, detail: setup.text.replace(/\s+/g, ' '), setup })),
        {
          title: 'H/Ai: copy the setup for your agent',
          placeHolder: 'Pick your agent (Copilot in VS Code needs no setup)',
          matchOnDetail: true,
        },
      );
      if (!pick) return;
      await vscode.env.clipboard.writeText(pick.setup.text);
      vscode.window.setStatusBarMessage(`$(check) H/Ai: copied the ${pick.label} setup. ${pick.setup.hint}`, 10_000);
    }),
  );
  const mcpProvider = registerVsCodeMcpServer(context);
  if (mcpProvider) context.subscriptions.push(mcpProvider);

  installServer(context)
    .then(() => offerClaudeConnect(context, log))
    .catch(e => log.error(`H/Ai setup failed: ${e instanceof Error ? e.message : e}`));
}

export function deactivate() {}

async function openSource(el: PickedElement, log: vscode.LogOutputChannel) {
  const src = el.source;
  log.info(`picked <${el.tag}> ${src ? `${src.path}:${src.line}:${src.column}` : '(no source tag)'}`);
  if (!src?.file) {
    const why = src
      ? `could not find ${src.path} in this workspace`
      : 'it has no source location. Add the hai-browser-vite plugin to your dev server';
    vscode.window.showInformationMessage(`H/Ai: picked <${el.tag}>, but ${why}. Agents can still read it with browser_get_selection.`);
    return;
  }
  const pos = new vscode.Position(Math.max(0, src.line - 1), Math.max(0, src.column - 1));
  await vscode.window.showTextDocument(vscode.Uri.file(src.file), {
    viewColumn: vscode.ViewColumn.Beside,
    selection: new vscode.Range(pos, pos),
    preview: true,
  });
}

/** Run a request, first asking the user about risky actions, and remember what the agent read. */
async function guarded(bridge: BrowserBridge, guard: ActionGuard, req: AgentRequest, connection: string): Promise<unknown> {
  if (vscode.workspace.getConfiguration('haiBrowser').get<boolean>('confirmActions', true)) {
    const params = (req.params ?? {}) as Record<string, any>;
    const ref = typeof params.ref === 'string' ? params.ref : undefined;
    const target = ref ? await bridge.describeRef(ref) : undefined;
    const risk = guard.check(connection, { method: req.method, params, url: bridge.pageInfo()?.url, target });
    if (risk) await confirm(risk, guard, connection, req.client?.name);
  }
  const result = (await dispatch(bridge, req)) as { url?: string; tree?: unknown; snapshot?: unknown } | undefined;
  const read = typeof result?.tree === 'string' ? result.tree : typeof result?.snapshot === 'string' ? result.snapshot : undefined;
  if (read) guard.noteRead(connection, result?.url, read);
  return result;
}

async function confirm(risk: Risk, guard: ActionGuard, connection: string, client?: string) {
  const once: vscode.MessageItem = { title: 'Allow once' };
  const site: vscode.MessageItem = { title: 'Allow on this site' };
  const stop: vscode.MessageItem = { title: 'Stop', isCloseAffordance: true };
  const pick = await vscode.window.showWarningMessage(
    `${agentName(client)} wants to ${risk.action}.`,
    { modal: true, detail: `${risk.why}\n\n"Allow on this site" won't ask again on ${risk.site} until the agent disconnects.` },
    once,
    site,
    stop,
  );
  if (pick === site) guard.allow(connection, risk.site);
  else if (pick !== once) {
    throw new Error(
      `The user stopped this action (${risk.action}). Don't retry it or find another way to do it: tell the user what you were about to do and why, and ask how to continue.`,
    );
  }
}

async function dispatch(bridge: BrowserBridge, req: AgentRequest): Promise<unknown> {
  const p = req.params as any;
  const opts = { snapshot: p.snapshot, screenshot: p.screenshot };
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
      return bridge.click({ ...opts, ...target(p), button: p.button, clickCount: p.clickCount, modifiers: p.modifiers });
    case 'hover':
      return bridge.hover({ ...opts, ...target(p) });
    case 'scroll':
      return bridge.scroll({ ...opts, ...target(p), deltaX: p.deltaX, deltaY: p.deltaY });
    case 'drag':
      return bridge.drag({ ...opts, from: target(p.from ?? {}), to: target(p.to ?? {}) });
    case 'type':
      return bridge.type({ ...opts, ref: requireString(p.ref, 'ref'), text: String(p.text ?? ''), clear: p.clear, submit: p.submit });
    case 'press':
      return bridge.press({ ...opts, key: requireString(p.key, 'key') });
    case 'select':
      return bridge.select({ ...opts, ref: requireString(p.ref, 'ref'), values: requireStrings(p.values, 'values') });
    case 'upload': {
      const paths = requireStrings(p.paths, 'paths');
      const roots = (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath);
      for (const file of paths) {
        if (!isAbsolute(file) || !roots.some(root => isInside(file, root))) {
          throw new Error(`Only files inside the open workspace folder can be uploaded (got ${file}). Use an absolute path.`);
        }
      }
      return bridge.upload({ ...opts, ref: requireString(p.ref, 'ref'), paths });
    }
    case 'dialog':
      return bridge.handleDialog({ ...opts, accept: p.accept !== false, promptText: p.promptText });
    case 'waitFor':
      return bridge.waitFor({ ...opts, text: p.text, textGone: p.textGone, timeSeconds: p.timeSeconds, timeoutSeconds: p.timeoutSeconds });
    case 'show':
      return bridge.show({ ...opts, text: optionalString(p.text), ref: optionalString(p.ref), label: optionalString(p.label) });
    case 'screenshot':
      return bridge.screenshot({ ref: p.ref, fullPage: p.fullPage, annotate: p.annotate });
    case 'console':
      return bridge.console(p.since, p.limit);
    case 'network':
      return bridge.network(p.since, p.limit, p.filter);
    case 'evaluate':
      if (!vscode.workspace.getConfiguration('haiBrowser').get<boolean>('allowEvaluate')) {
        throw new Error('browser_evaluate is disabled. The user can enable the "haiBrowser.allowEvaluate" setting.');
      }
      return { value: await bridge.evaluate(requireString(p.expression, 'expression')) };
    case 'pick': {
      const timeoutMs = typeof p.timeoutMs === 'number' ? p.timeoutMs : undefined;
      // A notification toast would pause the integrated browser until dismissed, so hint in the status bar.
      const hint = vscode.window.setStatusBarMessage('$(inspect) H/Ai: an agent asked you to pick an element in the browser (Esc cancels)');
      try {
        return { selection: await bridge.pick(timeoutMs) };
      } finally {
        hint.dispose();
      }
    }
    case 'selection':
      return { selection: bridge.lastSelection };
    case 'tabs':
      return bridge.listTabs();
    case 'tabNew':
      return bridge.newTab(requireString(p.url, 'url'));
    case 'tabSelect':
      return bridge.selectTab(requireString(p.id, 'id'));
    case 'tabClose':
      return bridge.closeTab(typeof p.id === 'string' ? p.id : undefined);
    default:
      throw new Error(`Unknown method: ${req.method}`);
  }
}

function target(p: any): { ref?: string; x?: number; y?: number } {
  return {
    ref: typeof p.ref === 'string' && p.ref ? p.ref : undefined,
    x: typeof p.x === 'number' ? p.x : undefined,
    y: typeof p.y === 'number' ? p.y : undefined,
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function requireStrings(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || !value.length || !value.every(v => typeof v === 'string')) {
    throw new Error(`"${name}" must be a non-empty array of strings.`);
  }
  return value;
}

function isInside(file: string, root: string) {
  const rel = relative(root, file);
  return !!rel && !rel.startsWith('..') && !isAbsolute(rel);
}

function requireString(v: unknown, name: string): string {
  if (typeof v !== 'string' || !v) throw new Error(`"${name}" is required.`);
  return v;
}
