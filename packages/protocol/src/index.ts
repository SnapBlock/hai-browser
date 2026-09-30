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
  click: { params: { ref: string }; result: ActionResult };
  type: {
    params: { ref: string; text: string; clear?: boolean; submit?: boolean };
    result: ActionResult;
  };
  press: { params: { key: string }; result: ActionResult };
  screenshot: { params: { ref?: string; fullPage?: boolean }; result: ScreenshotResult };
  console: { params: { since?: number; limit?: number }; result: ConsoleResult };
  evaluate: { params: { expression: string }; result: { value: unknown } };
  /** Let the user pick an element in the shared tab; resolves with it (or none on cancel/timeout). */
  pick: { params: { timeoutMs?: number }; result: SelectionResult };
  /** The element the user most recently picked. */
  selection: { params: Record<string, never>; result: SelectionResult };
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
}

export interface SnapshotResult {
  url: string;
  title: string;
  /** Indented, accessibility-style outline. Interactive elements carry `[ref=eN]`. */
  tree: string;
  truncated: boolean;
}

export interface ActionResult {
  ok: true;
  url: string;
}

export interface ScreenshotResult {
  mimeType: 'image/png';
  /** Base64 encoded image. */
  data: string;
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
