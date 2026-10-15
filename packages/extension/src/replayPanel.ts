import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { resolveSource } from './browser';
import { agentName, formatDuration, renderReplay } from './replayHtml';
import type { RunRecorder } from './runRecorder';

/** Let the user pick a saved run (newest first) and open it. */
export async function pickAndReplay(recorder: RunRecorder) {
  const runs = recorder.list().filter(r => r.steps > 0);
  if (!runs.length) {
    vscode.window.showInformationMessage(
      'H/Ai: no agent runs recorded yet. Runs are saved while an agent uses the shared browser.',
    );
    return;
  }
  const picked = await vscode.window.showQuickPick(
    runs.map(r => ({
      label: `$(history) ${agentName(r.agent)} · ${r.steps} step${r.steps === 1 ? '' : 's'}${r.errors ? ` · ${r.errors} error${r.errors === 1 ? '' : 's'}` : ''}`,
      description: `${new Date(r.startedAt).toLocaleString()} · ${formatDuration(r.endedAt - r.startedAt)}`,
      detail: r.lastTitle ? `${r.lastTitle} — ${r.firstUrl ?? ''}` : r.firstUrl,
      id: r.id,
    })),
    { title: 'H/Ai: Replay Agent Run', placeHolder: 'Pick a run to replay' },
  );
  if (picked) openReplay(recorder, picked.id);
}

export function openReplay(recorder: RunRecorder, id: string) {
  const run = recorder.load(id);
  if (!run) return void vscode.window.showWarningMessage('H/Ai: that run is no longer saved.');
  const panel = vscode.window.createWebviewPanel(
    'haiBrowser.replay',
    `Replay: ${agentName(run.agent)} run`,
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.file(run.dir)] },
  );
  panel.iconPath = new vscode.ThemeIcon('history');
  const webview = panel.webview;
  webview.html = renderReplay(run, {
    image: file => webview.asWebviewUri(vscode.Uri.file(join(run.dir, file))).toString(),
    webview: { cspSource: webview.cspSource, nonce: randomBytes(16).toString('base64') },
  });
  webview.onDidReceiveMessage(async (msg: { type: string; src?: string }) => {
    if (msg.type === 'export') await exportRun(recorder, id);
    else if (msg.type === 'openSource' && msg.src) await openSource(msg.src);
  });
}

/** Write the run as one self-contained HTML file (screenshots inlined). */
export function exportHtml(recorder: RunRecorder, id: string): string | undefined {
  const run = recorder.load(id);
  if (!run) return undefined;
  return renderReplay(run, {
    image: file => `data:image/jpeg;base64,${readFileSync(join(run.dir, file)).toString('base64')}`,
  });
}

async function exportRun(recorder: RunRecorder, id: string) {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri ?? vscode.Uri.file(homedir());
  const target = await vscode.window.showSaveDialog({
    title: 'Export agent run',
    defaultUri: vscode.Uri.joinPath(folder, `hai-run-${id.slice(0, 19)}.html`),
    filters: { HTML: ['html'] },
  });
  if (!target) return;
  const html = exportHtml(recorder, id);
  if (!html) return;
  writeFileSync(target.fsPath, html);
  const open = await vscode.window.showInformationMessage(`H/Ai: saved ${target.fsPath}`, 'Open in Browser');
  if (open) vscode.env.openExternal(target);
}

async function openSource(src: string) {
  const loc = await resolveSource(src);
  if (!loc?.file) return void vscode.window.showWarningMessage(`H/Ai: could not find ${src} in this workspace.`);
  const doc = await vscode.workspace.openTextDocument(loc.file);
  const pos = new vscode.Position(Math.max(0, (loc.line ?? 1) - 1), Math.max(0, (loc.column ?? 1) - 1));
  await vscode.window.showTextDocument(doc, { selection: new vscode.Range(pos, pos), viewColumn: vscode.ViewColumn.One });
}
