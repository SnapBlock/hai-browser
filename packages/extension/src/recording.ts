import * as vscode from 'vscode';
import type { ActionResult, AgentRequest, SnapshotResult } from '@hai-browser/protocol';
import type { BrowserBridge } from './browser';
import { SECRET_FIELD } from './guard';
import { NO_SCREENSHOT, RunRecorder, TOOL_NAMES, cleanParams, type StepTarget } from './runRecorder';

/** Methods whose whole point is a new page: their step isn't marked as leaving one. */
const GOES_TO = new Set(['open', 'navigate', 'tabNew', 'tabSelect', 'tabClose']);

const enabled = () => vscode.workspace.getConfiguration('haiBrowser').get<boolean>('recordRuns', true);

/** Run one agent request and save it as a step of that agent's run: inputs, target, where it landed, a screenshot and the result. */
export async function recordStep(
  bridge: BrowserBridge,
  recorder: RunRecorder,
  req: AgentRequest,
  connection: string,
  run: () => Promise<unknown>,
  onSaved: () => void,
  log: vscode.LogOutputChannel,
): Promise<unknown> {
  if (!enabled()) return run();
  const method = req.method as string;
  const p = (req.params ?? {}) as Record<string, any>;
  const ref: string | undefined = typeof p.ref === 'string' ? p.ref : typeof p.from?.ref === 'string' ? p.from.ref : undefined;
  const info = ref ? await bridge.describeRef(ref) : undefined;
  const before = bridge.pageInfo()?.url;
  bridge.beginTrace();
  const startedAt = Date.now();
  let result: unknown;
  let error: unknown;
  try {
    result = await run();
  } catch (e) {
    error = e;
  }
  const durationMs = Date.now() - startedAt;
  try {
    const trace = bridge.endTrace();
    const shot = NO_SCREENSHOT.has(method) ? undefined : await bridge.traceShot();
    const r = (result ?? {}) as Partial<ActionResult & SnapshotResult>;
    const page = typeof r.url === 'string' ? { url: r.url, title: r.title ?? '' } : bridge.pageInfo();
    // If the field couldn't be checked, don't keep what was typed into it.
    const secret = info ? info.secret || SECRET_FIELD.test(info.name ?? '') : method === 'type' || method === 'dialog';
    const typed = method === 'type' ? p.text : method === 'dialog' ? p.promptText : undefined;
    const target: StepTarget | undefined = ref ? { ref, role: info?.role, name: info?.name, src: info?.src } : undefined;
    recorder.addStep(
      recorder.runFor(connection, req.client?.name),
      {
        method,
        tool: TOOL_NAMES[method] ?? method,
        startedAt,
        durationMs,
        params: cleanParams(method, p, secret),
        target,
        points: trace.points.length ? trace.points : undefined,
        box: trace.box,
        url: page?.url,
        title: page?.title,
        shown: r.shown?.text,
        error: error === undefined ? undefined : error instanceof Error ? error.message : String(error),
        read: method === 'snapshot' && typeof r.tree === 'string' ? r.tree : undefined,
        from: before && page?.url && before !== page.url && !GOES_TO.has(method) ? before : undefined,
        viewport: shot?.width && shot.height ? { width: shot.width, height: shot.height } : undefined,
      },
      shot?.data,
      secret && typeof typed === 'string' ? typed : undefined,
    );
    onSaved();
  } catch (e) {
    log.warn(`Could not record ${method}: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (error !== undefined) throw error;
  return result;
}
