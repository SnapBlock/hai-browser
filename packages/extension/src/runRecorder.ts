import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** The element an action targeted, described before the action ran. */
export interface StepTarget {
  ref?: string;
  role?: string;
  name?: string;
  /** `data-hai-src` of the element, e.g. `src/PlanCard.tsx:6:7`. */
  src?: string;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RunStep {
  seq: number;
  method: string;
  tool: string;
  startedAt: number;
  durationMs: number;
  params: Record<string, unknown>;
  target?: StepTarget;
  /** Viewport CSS pixels where the action landed (clicks, drags, typing). */
  points?: { x: number; y: number }[];
  box?: Box;
  url?: string;
  title?: string;
  shown?: string;
  error?: string;
  /** What the agent read, for snapshots (trimmed). */
  read?: string;
  /** File name of the screenshot taken after the step, inside the run folder. */
  screenshot?: string;
  viewport?: { width: number; height: number };
  /** The page the step started on, when the step left it (the screenshot then shows the new page). */
  from?: string;
}

export interface RunInfo {
  id: string;
  startedAt: number;
  endedAt: number;
  agent?: string;
  steps: number;
  errors: number;
  firstUrl?: string;
  lastTitle?: string;
}

export interface Run extends RunInfo {
  dir: string;
  stepList: RunStep[];
}

export const TOOL_NAMES: Record<string, string> = {
  status: 'browser_status',
  share: 'browser_request_share',
  open: 'browser_open',
  navigate: 'browser_navigate',
  snapshot: 'browser_snapshot',
  click: 'browser_click',
  hover: 'browser_hover',
  scroll: 'browser_scroll',
  drag: 'browser_drag',
  type: 'browser_type',
  press: 'browser_press_key',
  select: 'browser_select_option',
  upload: 'browser_upload_file',
  dialog: 'browser_handle_dialog',
  waitFor: 'browser_wait_for',
  show: 'browser_show',
  screenshot: 'browser_screenshot',
  console: 'browser_console',
  network: 'browser_network',
  evaluate: 'browser_evaluate',
  pick: 'browser_get_selection',
  selection: 'browser_get_selection',
  tabs: 'browser_tabs',
  tabNew: 'browser_tab_new',
  tabSelect: 'browser_tab_select',
  tabClose: 'browser_tab_close',
};

/** Methods that only read extension state: recorded, but without a screenshot. */
export const NO_SCREENSHOT = new Set(['status', 'console', 'network', 'tabs', 'selection']);

export const MASK = '••••••';
const MAX_PARAM_CHARS = 2000;
const MAX_READ_CHARS = 20_000;

/** Copy params for the log: drop images, hide secrets, trim long strings. */
export function cleanParams(method: string, params: unknown, secret = false): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!params || typeof params !== 'object') return out;
  for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
    if (method === 'type' && key === 'text' && secret) out[key] = MASK;
    else if (method === 'dialog' && key === 'promptText' && secret) out[key] = MASK;
    else if (typeof value === 'string') out[key] = value.length > MAX_PARAM_CHARS ? value.slice(0, MAX_PARAM_CHARS) + '…' : value;
    else out[key] = value;
  }
  return out;
}

const quote = (s: string, max = 60) => `"${s.length > max ? s.slice(0, max - 1) + '…' : s}"`;
const targetLabel = (step: RunStep) => {
  const t = step.target;
  if (t?.role || t?.name) return [t.role, t.name ? quote(t.name) : ''].filter(Boolean).join(' ');
  const p = step.params;
  if (typeof p.x === 'number' && typeof p.y === 'number') return `(${Math.round(p.x)}, ${Math.round(p.y)})`;
  return t?.ref ?? '';
};

/** One-line, human-readable summary of a step. */
export function describeStep(step: RunStep): string {
  const p = step.params;
  const on = targetLabel(step);
  switch (step.method) {
    case 'open':
    case 'tabNew':
      return `Open ${p.url}`;
    case 'navigate':
      return p.url ? `Go to ${p.url}` : `Go ${p.action ?? 'back'}`;
    case 'snapshot':
      return 'Read the page';
    case 'click': {
      const verb = p.clickCount === 2 ? 'Double-click' : p.button === 'right' ? 'Right-click' : 'Click';
      return `${verb} ${on}`.trim();
    }
    case 'hover':
      return `Hover ${on}`.trim();
    case 'scroll':
      return on ? `Scroll ${on}` : `Scroll ${Number(p.deltaY ?? 0) >= 0 ? 'down' : 'up'}`;
    case 'drag':
      return 'Drag';
    case 'type':
      return `Type ${quote(String(p.text ?? ''))}${on ? ` into ${on}` : ''}${p.submit ? ' and submit' : ''}`;
    case 'press':
      return `Press ${p.key}`;
    case 'select':
      return `Choose ${(p.values as string[] | undefined)?.map(v => quote(v)).join(', ') ?? ''}${on ? ` in ${on}` : ''}`;
    case 'upload':
      return `Upload ${(p.paths as string[] | undefined)?.length ?? 0} file(s)`;
    case 'dialog':
      return p.accept === false ? 'Dismiss the dialog' : 'Accept the dialog';
    case 'waitFor':
      if (p.text) return `Wait for ${quote(String(p.text))}`;
      if (p.textGone) return `Wait for ${quote(String(p.textGone))} to go`;
      return `Wait ${p.timeSeconds}s`;
    case 'show':
      return `Show ${p.text ? quote(String(p.text)) : on}`;
    case 'screenshot':
      return 'Take a screenshot';
    case 'console':
      return 'Read the console';
    case 'network':
      return 'Read network requests';
    case 'evaluate':
      return 'Run JavaScript';
    case 'pick':
      return 'Ask you to pick an element';
    case 'selection':
      return 'Read your picked element';
    case 'status':
      return 'Check the browser';
    case 'share':
      return 'Ask you to share a tab';
    case 'tabs':
      return 'List tabs';
    case 'tabSelect':
      return `Switch to tab ${p.id}`;
    case 'tabClose':
      return 'Close a tab';
    default:
      return step.tool;
  }
}

export interface RecorderOptions {
  dir: string;
  keepRuns?: number;
  idleMs?: number;
  now?: () => number;
}

/** Saves agent steps to `<dir>/<runId>/run.json` plus one JPEG per step. One run per agent connection. */
export class RunRecorder {
  private readonly keepRuns: number;
  private readonly idleMs: number;
  private readonly now: () => number;
  private readonly active = new Map<string, Run>();

  constructor(private readonly opts: RecorderOptions) {
    this.keepRuns = opts.keepRuns ?? 20;
    this.idleMs = opts.idleMs ?? 10 * 60_000;
    this.now = opts.now ?? Date.now;
  }

  /** The run a new step from this connection belongs to; starts one after a long pause. */
  runFor(connection: string, agent?: string): Run {
    const now = this.now();
    let run = this.active.get(connection);
    if (run && now - run.endedAt > this.idleMs) run = undefined;
    if (!run) {
      const id = `${new Date(now).toISOString().replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 6)}`;
      run = { id, startedAt: now, endedAt: now, agent, steps: 0, errors: 0, dir: join(this.opts.dir, id), stepList: [] };
      mkdirSync(run.dir, { recursive: true });
      this.active.set(connection, run);
      this.prune();
    }
    if (agent) run.agent = agent;
    return run;
  }

  addStep(run: Run, step: Omit<RunStep, 'seq' | 'screenshot'>, jpegBase64?: string) {
    const seq = run.stepList.length + 1;
    const full: RunStep = { ...step, seq };
    if (full.read && full.read.length > MAX_READ_CHARS) full.read = full.read.slice(0, MAX_READ_CHARS) + '\n…';
    if (jpegBase64) {
      full.screenshot = `step-${String(seq).padStart(4, '0')}.jpg`;
      writeFileSync(join(run.dir, full.screenshot), Buffer.from(jpegBase64, 'base64'));
    }
    run.stepList.push(full);
    run.steps = seq;
    if (full.error) run.errors++;
    run.endedAt = step.startedAt + step.durationMs;
    run.firstUrl ??= full.url;
    if (full.title) run.lastTitle = full.title;
    const { dir: _dir, stepList, ...info } = run;
    writeFileSync(join(run.dir, 'run.json'), JSON.stringify({ ...info, stepList }, null, 1));
  }

  endConnection(connection: string) {
    this.active.delete(connection);
  }

  /** Saved runs, newest first. */
  list(): RunInfo[] {
    const runs: RunInfo[] = [];
    for (const id of this.ids()) {
      const run = this.load(id);
      if (run) runs.push((({ dir: _d, stepList: _s, ...info }) => info)(run));
    }
    return runs.sort((a, b) => b.startedAt - a.startedAt);
  }

  load(id: string): Run | undefined {
    if (!/^[\w-]+$/.test(id)) return undefined;
    const dir = join(this.opts.dir, id);
    try {
      const data = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')) as RunInfo & { stepList: RunStep[] };
      return { ...data, dir };
    } catch {
      return undefined;
    }
  }

  clear() {
    for (const id of this.ids()) rmSync(join(this.opts.dir, id), { recursive: true, force: true });
    this.active.clear();
  }

  private ids(): string[] {
    try {
      return readdirSync(this.opts.dir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
    } catch {
      return [];
    }
  }

  private prune() {
    const live = new Set([...this.active.values()].map(r => r.id));
    const ids = this.ids().sort().reverse();
    for (const id of ids.slice(this.keepRuns)) if (!live.has(id)) rmSync(join(this.opts.dir, id), { recursive: true, force: true });
  }
}
