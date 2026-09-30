import { isAbsolute, join } from 'node:path';
import * as vscode from 'vscode';
import {
  parseSourceTag,
  type ActionResult,
  type ConsoleEntry,
  type ConsoleResult,
  type PickedElement,
  type ScreenshotResult,
  type SnapshotResult,
  type SourceLocation,
  type StatusResult,
} from '@hai-browser/protocol';
import { CdpClient } from './cdp';
import {
  invoke,
  locateRef,
  pollPicker,
  snapshotPage,
  startPicker,
  stopPicker,
  type ElementBox,
  type PageElementInfo,
  type PickState,
} from './pageScripts';

const SESSION_NAME = 'H/Ai (shared browser)';
const PAGE_SESSION_TYPE = 'pwa-editor-browser';
const CONSOLE_CAPACITY = 500;
const SNAPSHOT_MAX_LINES = 1500;
const PICK_TIMEOUT_MS = 120_000;

const debugOptions: vscode.DebugSessionOptions = {
  suppressDebugToolbar: true,
  suppressDebugStatusbar: true,
  suppressDebugView: true,
  suppressSaveBeforeStart: true,
};

interface CdpProxyAddress {
  host: string;
  port: number;
  path: string;
}

const isOurPageSession = (s: vscode.DebugSession | undefined) =>
  s?.type === PAGE_SESSION_TYPE && s.parentSession?.name === SESSION_NAME;

/**
 * Owns the single integrated-browser tab that is shared with agents.
 *
 * VS Code's browser tab API is still proposed, so the tab is reached through the
 * built-in JavaScript debugger: an `editor-browser` debug session attaches to (or
 * launches) a tab, and `extension.js-debug.requestCDPProxy` exposes that page over CDP.
 */
export class BrowserBridge implements vscode.Disposable {
  private cdp?: CdpClient;
  private pageSession?: vscode.DebugSession;
  private connecting?: Promise<CdpClient>;
  private consoleSeq = 0;
  private readonly consoleEntries: ConsoleEntry[] = [];
  private readonly disposables: vscode.Disposable[] = [];
  private readonly changeEmitter = new vscode.EventEmitter<boolean>();
  readonly onDidChangeShared = this.changeEmitter.event;
  private selection?: PickedElement;
  private picking?: Promise<PickedElement | undefined>;
  private readonly pickEmitter = new vscode.EventEmitter<PickedElement>();
  /** Fires whenever the user picks an element, whether they or an agent started the picker. */
  readonly onDidPick = this.pickEmitter.event;

  constructor() {
    this.disposables.push(
      this.changeEmitter,
      this.pickEmitter,
      vscode.debug.onDidTerminateDebugSession(s => {
        if (s === this.pageSession || s === this.pageSession?.parentSession) this.reset();
      }),
    );
  }

  get shared() {
    return !!this.cdp && !this.cdp.isClosed;
  }

  async status(): Promise<StatusResult> {
    if (!this.shared) return { shared: false };
    const { url, title } = await this.evaluate<{ url: string; title: string }>(
      '({ url: location.href, title: document.title })',
    );
    return { shared: true, url, title };
  }

  /** Let the user pick an open browser tab (or open a new one) to share. */
  async share(): Promise<StatusResult> {
    await this.stop();
    await this.startSession({ type: 'editor-browser', request: 'attach', name: SESSION_NAME, urlFilter: '*' });
    return this.status();
  }

  /** Navigate the shared tab, or open and share a new tab when none is shared. */
  async open(url: string): Promise<StatusResult> {
    if (this.shared) return this.navigate({ url });
    await this.startSession({ type: 'editor-browser', request: 'launch', name: SESSION_NAME, url });
    await this.waitForLoad();
    return this.status();
  }

  async navigate(params: { url?: string; action?: 'back' | 'forward' | 'reload' }): Promise<StatusResult> {
    const cdp = this.requireCdp();
    if (params.url) {
      const res = await cdp.send<{ errorText?: string }>('Page.navigate', { url: params.url });
      if (res.errorText) throw new Error(`Navigation failed: ${res.errorText}`);
    } else if (params.action === 'reload') {
      await cdp.send('Page.reload', {});
    } else if (params.action === 'back' || params.action === 'forward') {
      const history = await cdp.send<{ currentIndex: number; entries: { id: number }[] }>(
        'Page.getNavigationHistory',
      );
      const entry = history.entries[history.currentIndex + (params.action === 'back' ? -1 : 1)];
      if (!entry) throw new Error(`Cannot go ${params.action}: no history entry.`);
      await cdp.send('Page.navigateToHistoryEntry', { entryId: entry.id });
    } else {
      throw new Error('Pass either "url" or "action".');
    }
    await this.waitForLoad();
    return this.status();
  }

  snapshot(): Promise<SnapshotResult> {
    return this.evaluate<SnapshotResult>(invoke(snapshotPage, SNAPSHOT_MAX_LINES));
  }

  async click(ref: string): Promise<ActionResult> {
    await this.bringToFront(this.requireCdp());
    const box = await this.locate(ref, false);
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    const cdp = this.requireCdp();
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    return this.actionResult();
  }

  async type(ref: string, text: string, clear = true, submit = false): Promise<ActionResult> {
    await this.locate(ref, true, clear);
    const cdp = this.requireCdp();
    if (clear) await this.pressKey('Backspace');
    await cdp.send('Input.insertText', { text });
    if (submit) await this.pressKey('Enter');
    return this.actionResult();
  }

  async press(key: string): Promise<ActionResult> {
    await this.pressKey(key);
    return this.actionResult();
  }

  async screenshot(ref?: string, fullPage = false): Promise<ScreenshotResult> {
    const cdp = this.requireCdp();
    const params: Record<string, unknown> = { format: 'png' };
    if (ref) {
      const box = await this.locate(ref, false);
      params.clip = { x: box.x + box.scrollX, y: box.y + box.scrollY, width: box.width, height: box.height, scale: 1 };
      params.captureBeyondViewport = true;
    } else if (fullPage) {
      params.captureBeyondViewport = true;
      const metrics = await cdp.send<{ cssContentSize: { width: number; height: number } }>('Page.getLayoutMetrics');
      params.clip = { x: 0, y: 0, ...metrics.cssContentSize, scale: 1 };
    }
    const { data } = await cdp.send<{ data: string }>('Page.captureScreenshot', params);
    return { mimeType: 'image/png', data };
  }

  console(since = 0, limit = 100): ConsoleResult {
    const entries = this.consoleEntries.filter(e => e.seq > since).slice(-limit);
    return { entries, lastSeq: this.consoleSeq };
  }

  evaluate<T = unknown>(expression: string): Promise<T> {
    return this.evaluateWithRetry<T>(expression);
  }

  get lastSelection(): PickedElement | undefined {
    return this.selection;
  }

  get isPicking() {
    return !!this.picking;
  }

  /** Let the user click an element in the shared tab. Resolves undefined on Escape, navigation or timeout. */
  pick(timeoutMs = PICK_TIMEOUT_MS): Promise<PickedElement | undefined> {
    this.requireCdp();
    this.picking ??= this.runPicker(timeoutMs).finally(() => {
      this.picking = undefined;
    });
    return this.picking;
  }

  async cancelPick() {
    if (this.shared) await this.evaluateOnce(invoke(stopPicker)).catch(() => {});
  }

  async stop() {
    const parent = this.pageSession?.parentSession ?? this.pageSession;
    this.reset();
    if (parent) await Promise.race([vscode.debug.stopDebugging(parent), delay(1500)]).catch(() => {});
  }

  dispose() {
    void this.stop();
    for (const d of this.disposables) d.dispose();
  }

  private reset() {
    const wasShared = this.shared;
    this.cdp?.close();
    this.cdp = undefined;
    this.pageSession = undefined;
    this.connecting = undefined;
    if (wasShared) this.changeEmitter.fire(false);
  }

  private requireCdp(): CdpClient {
    if (!this.shared) {
      throw new Error(
        'No browser tab is shared. Call browser_open with a URL, or ask the user to run "H/Ai: Share Browser Tab with Agent".',
      );
    }
    return this.cdp!;
  }

  private async startSession(config: vscode.DebugConfiguration) {
    if (this.connecting) {
      await this.connecting;
      return;
    }
    this.connecting = (async () => {
      const sessionPromise = waitForPageSession(30_000);
      const started = await vscode.debug.startDebugging(undefined, { ...config, internalConsoleOptions: 'neverOpen' }, debugOptions);
      if (!started) throw new Error('Could not start an integrated browser debug session.');
      const session = await sessionPromise;
      const address = await vscode.commands.executeCommand<CdpProxyAddress | undefined>(
        'extension.js-debug.requestCDPProxy',
        session.id,
      );
      if (!address) throw new Error('js-debug did not return a CDP proxy for the browser tab.');
      const cdp = await CdpClient.connect(`ws://${address.host}:${address.port}${address.path}`);
      cdp.on('close', () => {
        if (this.cdp === cdp) this.reset();
      });
      this.pageSession = session;
      this.cdp = cdp;
      await this.subscribeToConsole(cdp);
      // The page reports itself hidden/unfocused to the debugger, and Chromium drops
      // mouse presses for hidden pages, so keep it "visible" while it is shared.
      await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
      await this.bringToFront(cdp);
      this.changeEmitter.fire(true);
      return cdp;
    })();
    try {
      await this.connecting;
    } finally {
      this.connecting = undefined;
    }
  }

  private async subscribeToConsole(cdp: CdpClient) {
    const add = (level: string, text: string, source?: string) => {
      this.consoleEntries.push({ seq: ++this.consoleSeq, time: Date.now(), level, text, source });
      if (this.consoleEntries.length > CONSOLE_CAPACITY) this.consoleEntries.shift();
    };
    cdp.on('Runtime.consoleAPICalled', (p: any) => {
      const frame = p.stackTrace?.callFrames?.[0];
      add(p.type, (p.args ?? []).map(formatRemoteObject).join(' '), frame ? `${frame.url}:${frame.lineNumber + 1}` : undefined);
    });
    cdp.on('Runtime.exceptionThrown', (p: any) => {
      const d = p.exceptionDetails;
      add('error', d?.exception?.description ?? d?.text ?? 'Uncaught exception', d?.url ? `${d.url}:${(d.lineNumber ?? 0) + 1}` : undefined);
    });
    cdp.on('Log.entryAdded', (p: any) => add(p.entry.level, p.entry.text, p.entry.url));
    await cdp.send('JsDebug.subscribe', {
      events: ['Runtime.consoleAPICalled', 'Runtime.exceptionThrown', 'Log.entryAdded'],
    });
    await cdp.send('Log.enable').catch(() => {});
  }

  private async runPicker(timeoutMs: number): Promise<PickedElement | undefined> {
    await this.bringToFront(this.requireCdp());
    await this.evaluate(invoke(startPicker));
    const deadline = Date.now() + timeoutMs;
    try {
      while (this.shared && Date.now() < deadline) {
        await delay(150);
        // Evaluation fails briefly while the page navigates; the next poll then reports "idle".
        const s = await this.evaluateOnce<PickState>(invoke(pollPicker)).catch(() => undefined);
        if (!s || s.state === 'picking') continue;
        if (s.state !== 'picked' || !s.picked) return undefined;
        const picked = await toPickedElement(s.picked);
        this.selection = picked;
        this.pickEmitter.fire(picked);
        return picked;
      }
      return undefined;
    } finally {
      await this.cancelPick();
    }
  }

  private async bringToFront(cdp: CdpClient) {
    await cdp.send('Page.bringToFront').catch(() => {});
  }

  private async locate(ref: string, focus: boolean, clear = false): Promise<ElementBox> {
    const box = await this.evaluate<ElementBox | { error: string }>(invoke(locateRef, ref, focus, clear));
    if ('error' in box) throw new Error(box.error);
    return box;
  }

  private async pressKey(key: string) {
    const cdp = this.requireCdp();
    const def = KEYS[key] ?? { key, code: key, keyCode: key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0 };
    const text = def.text ?? (key.length === 1 ? key : undefined);
    const base = { key: def.key, code: def.code, windowsVirtualKeyCode: def.keyCode, nativeVirtualKeyCode: def.keyCode };
    await cdp.send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', ...base, text, unmodifiedText: text });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  }

  private async actionResult(): Promise<ActionResult> {
    await delay(100);
    await this.waitForLoad(5_000);
    const { url } = await this.status();
    return { ok: true, url: url ?? '' };
  }

  private async waitForLoad(timeoutMs = 15_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const state = await this.evaluateOnce<string>('document.readyState').catch(() => undefined);
      if (state === 'complete') return;
      await delay(150);
    }
  }

  private async evaluateWithRetry<T>(expression: string, attempts = 5): Promise<T> {
    let lastError: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        return await this.evaluateOnce<T>(expression);
      } catch (e) {
        lastError = e;
        // The execution context is replaced during navigation; give the new one a moment.
        if (!/context|destroyed|navigat/i.test(String(e))) throw e;
        await delay(200);
      }
    }
    throw lastError;
  }

  private async evaluateOnce<T>(expression: string): Promise<T> {
    const res = await this.requireCdp().send<{ result: { value?: T }; exceptionDetails?: any }>('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    });
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.exception?.description ?? res.exceptionDetails.text ?? 'Evaluation failed');
    }
    return res.result.value as T;
  }
}

function waitForPageSession(timeoutMs: number): Promise<vscode.DebugSession> {
  if (isOurPageSession(vscode.debug.activeDebugSession)) return Promise.resolve(vscode.debug.activeDebugSession!);
  return new Promise((resolve, reject) => {
    const done = (fn: () => void) => {
      clearTimeout(timer);
      started.dispose();
      ended.dispose();
      fn();
    };
    const timer = setTimeout(
      () => done(() => reject(new Error('Timed out waiting for the integrated browser page.'))),
      timeoutMs,
    );
    const started = vscode.debug.onDidStartDebugSession(s => {
      if (isOurPageSession(s)) done(() => resolve(s));
    });
    const ended = vscode.debug.onDidTerminateDebugSession(s => {
      if (s.name === SESSION_NAME && !s.parentSession) {
        done(() => reject(new Error('No browser tab was shared (the picker was dismissed or the tab is empty).')));
      }
    });
  });
}

async function toPickedElement(info: PageElementInfo): Promise<PickedElement> {
  const { src, srcRoot, ...rest } = info;
  const source = src ? await resolveSource(src, srcRoot) : undefined;
  return { ...rest, source, pickedAt: Date.now() };
}

/** Map a `data-hai-src` path to a file on disk: absolute, dev-server root, workspace folders, then a search. */
async function resolveSource(src: string, srcRoot?: string): Promise<SourceLocation | undefined> {
  const loc = parseSourceTag(src);
  if (!loc) return undefined;
  const candidates = isAbsolute(loc.path) ? [loc.path] : [];
  if (srcRoot) candidates.push(join(srcRoot, loc.path));
  for (const folder of vscode.workspace.workspaceFolders ?? []) candidates.push(join(folder.uri.fsPath, loc.path));
  for (const file of candidates) {
    const exists = await vscode.workspace.fs.stat(vscode.Uri.file(file)).then(
      () => true,
      () => false,
    );
    if (exists) return { ...loc, file };
  }
  if (isAbsolute(loc.path)) return loc;
  const [found] = await vscode.workspace.findFiles(`**/${loc.path}`, '**/node_modules/**', 1);
  return found ? { ...loc, file: found.fsPath } : loc;
}

function formatRemoteObject(o: any): string {
  if (!o) return '';
  if ('value' in o) return typeof o.value === 'string' ? o.value : JSON.stringify(o.value);
  if (o.unserializableValue) return o.unserializableValue;
  return o.description ?? o.type ?? '';
}

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

const KEYS: Record<string, { key: string; code: string; keyCode: number; text?: string }> = {
  Enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  Tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  Backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  Delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  Home: { key: 'Home', code: 'Home', keyCode: 36 },
  End: { key: 'End', code: 'End', keyCode: 35 },
  PageUp: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
  PageDown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
  Space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
};
