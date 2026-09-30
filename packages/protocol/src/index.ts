import { homedir } from 'node:os';
import { join } from 'node:path';

/** Methods the extension's agent API accepts. */
export interface AgentMethods {
  status: { params: Record<string, never>; result: StatusResult };
  share: { params: Record<string, never>; result: StatusResult };
  open: { params: { url: string }; result: StatusResult };
  navigate: {
    params: { url?: string; action?: 'back' | 'forward' | 'reload' };
    result: StatusResult;
  };
  snapshot: { params: Record<string, never>; result: SnapshotResult };
  click: {
    params: PointTarget & ActionOptions & { button?: MouseButton; clickCount?: number; modifiers?: Modifier[] };
    result: ActionResult;
  };
  hover: { params: PointTarget & ActionOptions; result: ActionResult };
  scroll: { params: PointTarget & ActionOptions & { deltaX?: number; deltaY?: number }; result: ActionResult };
  drag: { params: ActionOptions & { from: PointTarget; to: PointTarget }; result: ActionResult };
  type: {
    params: ActionOptions & { ref: string; text: string; clear?: boolean; submit?: boolean };
    result: ActionResult;
  };
  press: { params: ActionOptions & { key: string }; result: ActionResult };
  select: { params: ActionOptions & { ref: string; values: string[] }; result: ActionResult };
  upload: { params: ActionOptions & { ref: string; paths: string[] }; result: ActionResult };
  dialog: { params: ActionOptions & { accept: boolean; promptText?: string }; result: ActionResult };
  waitFor: {
    params: ActionOptions & { text?: string; textGone?: string; timeSeconds?: number; timeoutSeconds?: number };
    result: ActionResult;
  };
  screenshot: { params: { ref?: string; fullPage?: boolean; annotate?: boolean }; result: ScreenshotResult };
  console: { params: { since?: number; limit?: number }; result: ConsoleResult };
  network: { params: { since?: number; limit?: number; filter?: string }; result: NetworkResult };
  evaluate: { params: { expression: string }; result: { value: unknown } };
  /** Let the user pick an element in the shared tab; resolves with it (or none on cancel/timeout). */
  pick: { params: { timeoutMs?: number }; result: SelectionResult };
  /** The element the user most recently picked. */
  selection: { params: Record<string, never>; result: SelectionResult };
  tabs: { params: Record<string, never>; result: TabsResult };
  tabNew: { params: { url: string }; result: StatusResult };
  tabSelect: { params: { id: string }; result: StatusResult };
  tabClose: { params: { id?: string }; result: TabsResult };
}

export type AgentMethod = keyof AgentMethods;

export interface AgentRequest<M extends AgentMethod = AgentMethod> {
  id: number;
  method: M;
  params: AgentMethods[M]['params'];
}

export type AgentResponse =
  | { id: number; result: unknown }
  | { id: number; error: { message: string } };

export interface StatusResult {
  shared: boolean;
  url?: string;
  title?: string;
  /** Id of the active shared tab (see `tabs`). */
  tabId?: string;
  /** Number of tabs shared with agents. */
  tabs?: number;
  dialog?: DialogInfo;
}

export interface SnapshotResult {
  url: string;
  title: string;
  /** Indented, accessibility-style outline. Interactive elements carry `[ref=eN]`. */
  tree: string;
  truncated: boolean;
}

/** An element ref from the latest snapshot, or a point in viewport CSS pixels (as in screenshots). */
export interface PointTarget {
  ref?: string;
  x?: number;
  y?: number;
}

export type MouseButton = 'left' | 'right' | 'middle';
export type Modifier = 'Alt' | 'Control' | 'Meta' | 'Shift';

export interface ActionOptions {
  /** Return the page snapshot after the action (default true). */
  snapshot?: boolean;
  /** Also return a viewport screenshot after the action. */
  screenshot?: boolean;
}

export interface ActionResult {
  ok: true;
  url: string;
  title: string;
  tabId: string;
  snapshot?: string;
  truncated?: boolean;
  screenshot?: ScreenshotResult;
  /** Set when a JavaScript dialog is open; the page is blocked until it is handled. */
  dialog?: DialogInfo;
}

export interface DialogInfo {
  type: 'alert' | 'confirm' | 'prompt' | 'beforeunload';
  message: string;
  defaultPrompt?: string;
}

export interface ScreenshotResult {
  mimeType: 'image/png';
  /** Base64 encoded image. */
  data: string;
  /** Image size in CSS pixels, when known. Viewport screenshots use the same coordinates as `x`/`y`. */
  width?: number;
  height?: number;
  /** For `annotate`: the snapshot whose refs are drawn on the image. */
  snapshot?: string;
}

export interface ConsoleEntry {
  seq: number;
  time: number;
  level: string;
  text: string;
  source?: string;
}

export interface ConsoleResult {
  entries: ConsoleEntry[];
  /** Pass as `since` to only receive newer entries next time. */
  lastSeq: number;
}

export interface NetworkEntry {
  seq: number;
  time: number;
  method: string;
  url: string;
  resourceType?: string;
  status?: number;
  statusText?: string;
  mimeType?: string;
  durationMs?: number;
  sizeBytes?: number;
  /** Error text when the request failed or was cancelled. */
  failed?: string;
}

export interface NetworkResult {
  entries: NetworkEntry[];
  /** Pass as `since` to only receive newer entries next time. */
  lastSeq: number;
}

export interface TabInfo {
  id: string;
  url: string;
  title: string;
  active: boolean;
}

export interface TabsResult {
  /** Tabs shared with agents; actions go to the active one. */
  tabs: TabInfo[];
  /** Other integrated-browser tabs open in VS Code that are not shared. */
  otherBrowserTabs: number;
}

export interface SourceLocation {
  /** Path as tagged in the page (relative to the dev server root). */
  path: string;
  line: number;
  column: number;
  /** Absolute path on disk, when the extension could resolve it. */
  file?: string;
}

export interface PickedElement {
  /** Ref usable with click/type/screenshot until the page changes. */
  ref: string;
  tag: string;
  selector: string;
  text: string;
  html: string;
  styles: Record<string, string>;
  rect: { x: number; y: number; width: number; height: number };
  url: string;
  source?: SourceLocation;
  pickedAt: number;
}

export interface SelectionResult {
  selection?: PickedElement;
}

/** Parse a `data-hai-src` value such as `src/App.tsx:12:7` (paths may contain colons). */
export function parseSourceTag(value: string): SourceLocation | undefined {
  const m = /^(.+):(\d+):(\d+)$/.exec(value.trim());
  if (!m) return undefined;
  return { path: m[1]!, line: Number(m[2]), column: Number(m[3]) };
}

export const MODIFIER_BITS: Record<Modifier, number> = { Alt: 1, Control: 2, Meta: 4, Shift: 8 };

const MODIFIER_ALIASES: Record<string, Modifier> = {
  alt: 'Alt', option: 'Alt', control: 'Control', ctrl: 'Control', meta: 'Meta', cmd: 'Meta', command: 'Meta', shift: 'Shift',
};

/** Parse a key or chord such as `Enter`, `a`, `Control+A`, `Shift+Tab` or `Control++`. */
export function parseKeyCombo(combo: string): { key: string; modifiers: Modifier[] } {
  const parts = combo.split('+');
  // A trailing "+" key ("Control++") splits into two empty strings.
  const key = combo.length > 1 && combo.endsWith('++') ? '+' : combo === '+' ? '+' : parts[parts.length - 1]!;
  const head = key === '+' ? parts.slice(0, -2) : parts.slice(0, -1);
  const modifiers: Modifier[] = [];
  for (const part of head) {
    const mod = MODIFIER_ALIASES[part.trim().toLowerCase()];
    if (!mod) throw new Error(`Unknown modifier "${part}" in "${combo}". Use Alt, Control, Meta or Shift.`);
    if (!modifiers.includes(mod)) modifiers.push(mod);
  }
  if (!key) throw new Error(`No key in "${combo}".`);
  return { key, modifiers };
}

export function modifierBits(modifiers: readonly Modifier[] = []): number {
  return modifiers.reduce((bits, m) => bits | (MODIFIER_BITS[m] ?? 0), 0);
}

/** Written by each VS Code window running the extension so local agents can find it. */
export interface Lockfile {
  pid: number;
  port: number;
  token: string;
  workspaceFolders: string[];
  startedAt: number;
}

export const AUTH_HEADER = 'x-hai-browser-token';

export function lockDir(home: string = homedir()): string {
  return join(home, '.hai-browser', 'sessions');
}
