import { isAbsolute, join } from 'node:path';
import * as vscode from 'vscode';
import {
  modifierBits,
  parseKeyCombo,
  parseSourceTag,
  type ActionOptions,
  type ActionResult,
  type ConsoleEntry,
  type ConsoleResult,
  type DialogInfo,
  type Modifier,
  type MouseButton,
  type NetworkEntry,
  type NetworkResult,
  type PickedElement,
  type PointTarget,
  type ScreenshotResult,
  type SnapshotResult,
  type SourceLocation,
  type StatusResult,
  type TabInfo,
  type TabsResult,
} from '@hai-browser/protocol';
import { CdpClient } from './cdp';
import {
  annotateRefs,
  cursorRipple,
  moveCursor,
  nextFrame,
  setCursorVisible,
  invoke,
  locateRef,
  pageHasText,
  pollPicker,
  removeAnnotations,
  selectOption,
  snapshotPage,
  startPicker,
  stopPicker,
  viewportInfo,
  type ElementBox,
  type PageElementInfo,
  type PickState,
  type Viewport,
} from './pageScripts';

const SESSION_NAME = 'H/Ai (shared browser)';
const PAGE_SESSION_TYPE = 'pwa-editor-browser';
const CONSOLE_CAPACITY = 500;
const NETWORK_CAPACITY = 500;
const SNAPSHOT_MAX_LINES = 4000;
const PICK_TIMEOUT_MS = 300_000;
/** How long js-debug's tab picker may stay up before we dismiss it when looking for an existing tab. */
const ATTACH_PICKER_GRACE_MS = 1500;
const CURSOR_MIN_MS = 180;
const CURSOR_MAX_MS = 550;
const DRAG_STEP_MS = 16;

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
  s?.type === PAGE_SESSION_TYPE && !!s.parentSession?.name.startsWith(SESSION_NAME);

/** Integrated-browser tabs show up in the tab API with no input type (their URL is not exposed). */
const browserTabCount = () =>
  vscode.window.tabGroups.all.reduce((n, g) => n + g.tabs.filter(t => t.input === undefined).length, 0);

const BUTTON_BITS: Record<MouseButton, number> = { left: 1, right: 2, middle: 4 };

const dialogError = (d: DialogInfo) =>
  new Error(`A ${d.type} dialog is open (${JSON.stringify(d.message)}). Call browser_handle_dialog to accept or dismiss it first.`);

/** One integrated-browser tab shared with agents, reached through its own js-debug CDP proxy. */
class BrowserTab implements vscode.Disposable {
  private consoleSeq = 0;
  private readonly consoleEntries: ConsoleEntry[] = [];
  private networkSeq = 0;
  private readonly networkEntries: NetworkEntry[] = [];
  private readonly inflight = new Map<string, { entry: NetworkEntry; start: number }>();
  private readonly dialogEmitter = new vscode.EventEmitter<DialogInfo>();
  readonly onDialog = this.dialogEmitter.event;
  dialog?: DialogInfo;
  cursor?: { x: number; y: number };
  url = '';
  title = '';

  constructor(
    readonly id: string,
    readonly session: vscode.DebugSession,
    readonly cdp: CdpClient,
  ) {}

  get isClosed() {
    return this.cdp.isClosed;
  }

  get rootSession() {
    return this.session.parentSession ?? this.session;
  }

  send<T = any>(method: string, params: object = {}): Promise<T> {
    return this.cdp.send<T>(method, params);
  }

  /** Reject if a JavaScript dialog opens first: the page (and most CDP calls) block until it is handled. */
  guard<T>(p: Promise<T>): Promise<T> {
    if (this.dialog) return Promise.reject(dialogError(this.dialog));
    return new Promise<T>((resolve, reject) => {
      const sub = this.onDialog(d => reject(dialogError(d)));
      p.then(resolve, reject).finally(() => sub.dispose());
    });
  }

  async init() {
    const cdp = this.cdp;
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
    cdp.on('Page.javascriptDialogOpening', (p: any) => {
      this.dialog = { type: p.type, message: p.message ?? '', defaultPrompt: p.defaultPrompt || undefined };
      this.dialogEmitter.fire(this.dialog);
    });
    cdp.on('Page.javascriptDialogClosed', () => {
      this.dialog = undefined;
    });
    cdp.on('Network.requestWillBeSent', (p: any) => this.onRequest(p));
    cdp.on('Network.responseReceived', (p: any) => {
      const r = this.inflight.get(p.requestId);
      if (!r) return;
      Object.assign(r.entry, { status: p.response.status, statusText: p.response.statusText || undefined, mimeType: p.response.mimeType });
    });
    cdp.on('Network.loadingFinished', (p: any) => this.finishRequest(p.requestId, p.timestamp, { sizeBytes: p.encodedDataLength }));
    cdp.on('Network.loadingFailed', (p: any) =>
      this.finishRequest(p.requestId, p.timestamp, { failed: p.canceled ? 'cancelled' : p.errorText || 'failed' }),
    );
    await cdp.send('JsDebug.subscribe', {
      events: [
        'Runtime.consoleAPICalled',
        'Runtime.exceptionThrown',
        'Log.entryAdded',
        'Page.javascriptDialogOpening',
        'Page.javascriptDialogClosed',
        'Network.requestWillBeSent',
        'Network.responseReceived',
        'Network.loadingFinished',
        'Network.loadingFailed',
      ],
    });
    for (const domain of ['Log', 'Page', 'Network']) await cdp.send(`${domain}.enable`).catch(() => {});
    // The page reports itself hidden/unfocused to the debugger, and Chromium drops
    // mouse presses for hidden pages, so keep it "visible" while it is shared.
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
    await cdp.send('Page.bringToFront').catch(() => {});
  }

  console(since = 0, limit = 100): ConsoleResult {
    return { entries: this.consoleEntries.filter(e => e.seq > since).slice(-limit), lastSeq: this.consoleSeq };
  }

  network(since = 0, limit = 100, filter?: string): NetworkResult {
    const f = filter?.toLowerCase();
    const entries = this.networkEntries.filter(e => e.seq > since && (!f || e.url.toLowerCase().includes(f))).slice(-limit);
    return { entries, lastSeq: this.networkSeq };
  }

  private onRequest(p: any) {
    const url: string = p.request?.url ?? '';
    if (url.startsWith('data:')) return;
    const existing = this.inflight.get(p.requestId);
    if (existing && p.redirectResponse) {
      // A redirect reuses the request id: close out the previous hop and start a new entry.
      Object.assign(existing.entry, { status: p.redirectResponse.status, statusText: p.redirectResponse.statusText || undefined });
      this.finishRequest(p.requestId, p.timestamp, {});
    }
    const entry: NetworkEntry = { seq: ++this.networkSeq, time: Date.now(), method: p.request?.method ?? 'GET', url, resourceType: p.type };
    this.networkEntries.push(entry);
    if (this.networkEntries.length > NETWORK_CAPACITY) this.networkEntries.shift();
    this.inflight.set(p.requestId, { entry, start: p.timestamp });
    if (this.inflight.size > NETWORK_CAPACITY) this.inflight.delete(this.inflight.keys().next().value!);
  }

  private finishRequest(requestId: string, timestamp: number, extra: Partial<NetworkEntry>) {
    const r = this.inflight.get(requestId);
    if (!r) return;
    this.inflight.delete(requestId);
    Object.assign(r.entry, extra);
    if (typeof timestamp === 'number' && typeof r.start === 'number') r.entry.durationMs = Math.round((timestamp - r.start) * 1000);
  }

  dispose() {
    this.dialogEmitter.dispose();
    this.cdp.close();
  }
}

/**
 * Owns the integrated-browser tabs shared with agents; actions go to the active tab.
 *
 * VS Code's browser tab API is still proposed, so tabs are reached through the
 * built-in JavaScript debugger: an `editor-browser` debug session attaches to (or
 * launches) a tab, and `extension.js-debug.requestCDPProxy` exposes that page over CDP.
 */
export class BrowserBridge implements vscode.Disposable {
  private readonly tabs = new Map<string, BrowserTab>();
  private activeId?: string;
  private nextTabId = 1;
  private connecting?: Promise<BrowserTab>;
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
        for (const tab of [...this.tabs.values()]) if (s === tab.session || s === tab.rootSession) this.removeTab(tab.id);
      }),
    );
  }

  get shared() {
    return !!this.activeTab;
  }

  get tabCount() {
    return this.tabs.size;
  }

  private get activeTab(): BrowserTab | undefined {
    const tab = this.activeId ? this.tabs.get(this.activeId) : undefined;
    return tab && !tab.isClosed ? tab : undefined;
  }

  async status(): Promise<StatusResult> {
    const tab = this.activeTab;
    if (!tab) return { shared: false };
    if (!tab.dialog) await this.refreshInfo(tab).catch(() => {});
    return { shared: true, tabId: tab.id, url: tab.url, title: tab.title, tabs: this.tabCount, dialog: tab.dialog };
  }

  /** Let the user pick an open browser tab (or open a new one) to share. It becomes the active tab. */
  async share(): Promise<StatusResult> {
    await this.connect({ type: 'editor-browser', request: 'attach', urlFilter: '*' });
    return this.status();
  }

  /** Navigate the active tab; with no shared tab, reuse an open tab showing `url` or open a new one. */
  async open(url: string): Promise<StatusResult> {
    if (this.activeTab) return this.navigate({ url });
    if (!(await this.attachExisting(url))) await this.launch(url);
    return this.status();
  }

  async newTab(url: string): Promise<StatusResult> {
    await this.launch(url);
    return this.status();
  }

  async navigate(params: { url?: string; action?: 'back' | 'forward' | 'reload' }): Promise<StatusResult> {
    const tab = this.requireTab();
    if (params.url) {
      const res = await tab.send<{ errorText?: string }>('Page.navigate', { url: params.url });
      if (res.errorText) throw new Error(`Navigation failed: ${res.errorText}`);
    } else if (params.action === 'reload') {
      await tab.send('Page.reload', {});
    } else if (params.action === 'back' || params.action === 'forward') {
      const history = await tab.send<{ currentIndex: number; entries: { id: number }[] }>('Page.getNavigationHistory');
      const entry = history.entries[history.currentIndex + (params.action === 'back' ? -1 : 1)];
      if (!entry) throw new Error(`Cannot go ${params.action}: no history entry.`);
      await tab.send('Page.navigateToHistoryEntry', { entryId: entry.id });
    } else {
      throw new Error('Pass either "url" or "action".');
    }
    await this.waitForLoad(tab);
    return this.status();
  }

  async listTabs(): Promise<TabsResult> {
    const tabs: TabInfo[] = [];
    for (const tab of this.tabs.values()) {
      if (!tab.dialog) await this.refreshInfo(tab).catch(() => {});
      tabs.push({ id: tab.id, url: tab.url, title: tab.title, active: tab.id === this.activeId });
    }
    return { tabs, otherBrowserTabs: Math.max(0, browserTabCount() - tabs.length) };
  }

  async selectTab(id: string): Promise<StatusResult> {
    const tab = this.tabs.get(id);
    if (!tab) throw new Error(`No shared tab "${id}". Call browser_tabs to list them.`);
    this.activeId = id;
    await tab.send('Page.bringToFront').catch(() => {});
    this.changeEmitter.fire(true);
    return this.status();
  }

  async closeTab(id?: string): Promise<TabsResult> {
    const tab = id ? this.tabs.get(id) : this.activeTab;
    if (!tab) throw new Error(id ? `No shared tab "${id}".` : 'No browser tab is shared.');
    const title = tab.title;
    this.removeTab(tab.id);
    await Promise.race([vscode.debug.stopDebugging(tab.rootSession), delay(1500)]).catch(() => {});
    await closeEditorTab(title);
    return this.listTabs();
  }

  snapshot(): Promise<SnapshotResult> {
    return this.snapshotIn(this.requireTab());
  }

  click(p: PointTarget & ActionOptions & { button?: MouseButton; clickCount?: number; modifiers?: Modifier[] }) {
    return this.act(p, async tab => {
      const { x, y } = await this.aim(tab, p);
      const button = p.button ?? 'left';
      const modifiers = modifierBits(p.modifiers);
      const count = Math.min(Math.max(Math.round(p.clickCount ?? 1), 1), 3);
      await tab.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, modifiers });
      await this.ripple(tab, { x, y });
      for (let clickCount = 1; clickCount <= count; clickCount++) {
        const base = { x, y, button, clickCount, modifiers };
        await tab.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base, buttons: BUTTON_BITS[button] });
        await tab.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base, buttons: 0 });
      }
    });
  }

  hover(p: PointTarget & ActionOptions) {
    return this.act(p, async tab => {
      const { x, y } = await this.aim(tab, p);
      await tab.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    });
  }

  scroll(p: PointTarget & ActionOptions & { deltaX?: number; deltaY?: number }) {
    return this.act(p, async tab => {
      const deltaX = p.deltaX ?? 0;
      const deltaY = p.deltaY ?? 0;
      if (p.ref && !deltaX && !deltaY) {
        await this.locate(tab, p.ref, false);
        return;
      }
      if (!deltaX && !deltaY) throw new Error('Pass deltaY (positive scrolls down) and/or deltaX, or a ref to scroll into view.');
      let at: { x: number; y: number };
      if (p.ref || (typeof p.x === 'number' && typeof p.y === 'number')) {
        at = await this.aim(tab, p);
      } else {
        const v = await this.viewport(tab);
        at = { x: v.width / 2, y: v.height / 2 };
      }
      await tab.send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...at, deltaX, deltaY });
      await delay(200);
    });
  }

  drag(p: ActionOptions & { from: PointTarget; to: PointTarget }) {
    return this.act(p, async tab => {
      const a = await this.aim(tab, p.from);
      const b = await this.point(tab, p.to);
      await tab.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...a });
      await tab.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...a, button: 'left', buttons: 1, clickCount: 1 });
      const cursor = this.showCursor();
      const steps = 12;
      let prev = a;
      for (let i = 1; i <= steps; i++) {
        const at = { x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps };
        await tab.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...at, button: 'left', buttons: 1 });
        if (cursor) await this.evaluateOnce(tab, invoke(moveCursor, prev.x, prev.y, at.x, at.y, DRAG_STEP_MS)).catch(() => {});
        prev = at;
        await delay(DRAG_STEP_MS);
      }
      tab.cursor = b;
      // Chromium dispatches mouse moves with the next frame; release only once they have reached the page.
      await this.evaluateOnce(tab, invoke(nextFrame, 200)).catch(() => {});
      await tab.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...b, button: 'left', buttons: 0, clickCount: 1 });
    });
  }

  type(p: ActionOptions & { ref: string; text: string; clear?: boolean; submit?: boolean }) {
    const clear = p.clear ?? true;
    return this.act(p, async tab => {
      const box = await this.locate(tab, p.ref, true, clear);
      await this.glide(tab, { x: box.x + Math.min(box.width / 2, 24), y: box.y + box.height / 2 });
      if (clear) await this.pressKey(tab, 'Backspace');
      await tab.send('Input.insertText', { text: p.text });
      if (p.submit) await this.pressKey(tab, 'Enter');
    });
  }

  press(p: ActionOptions & { key: string }) {
    return this.act(p, tab => this.pressKey(tab, p.key));
  }

  select(p: ActionOptions & { ref: string; values: string[] }) {
    return this.act(p, async tab => {
      const res = await this.evaluateIn<{ selected: string[] } | { error: string }>(tab, invoke(selectOption, p.ref, p.values));
      if ('error' in res) throw new Error(res.error);
    });
  }

  upload(p: ActionOptions & { ref: string; paths: string[] }) {
    return this.act(p, async tab => {
      const found = await tab.guard(
        tab.send<{ result: { objectId?: string } }>('Runtime.evaluate', {
          expression: `window.__hai?.refs.get(${JSON.stringify(p.ref)})?.deref() ?? null`,
        }),
      );
      const objectId = found.result.objectId;
      if (!objectId) throw new Error(`Unknown or stale ref "${p.ref}". Take a new snapshot.`);
      const check = await tab.send<{ result: { value?: boolean } }>('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: 'function () { return this instanceof HTMLInputElement && this.type === "file"; }',
        returnByValue: true,
      });
      if (!check.result.value) throw new Error(`Element ${p.ref} is not a file input.`);
      await tab.send('DOM.setFileInputFiles', { objectId, files: p.paths });
    });
  }

  async handleDialog(p: ActionOptions & { accept: boolean; promptText?: string }): Promise<ActionResult> {
    const tab = this.requireTab(true);
    if (!tab.dialog) throw new Error('No dialog is open.');
    await tab.send('Page.handleJavaScriptDialog', { accept: p.accept, promptText: p.promptText });
    tab.dialog = undefined;
    await delay(100);
    await this.waitForLoad(tab, 5_000);
    return this.result(tab, p);
  }

  async waitFor(p: ActionOptions & { text?: string; textGone?: string; timeSeconds?: number; timeoutSeconds?: number }) {
    const tab = this.requireTab();
    if (!p.text && !p.textGone && !p.timeSeconds) throw new Error('Pass "text", "textGone" or "timeSeconds".');
    if (p.timeSeconds) await delay(Math.min(p.timeSeconds, 60) * 1000);
    const timeout = Math.min(p.timeoutSeconds ?? 30, 120);
    const deadline = Date.now() + timeout * 1000;
    while (p.text || p.textGone) {
      if (tab.dialog) break;
      const has = (t: string) => this.evaluateIn<boolean>(tab, invoke(pageHasText, t)).catch(() => undefined);
      const shown = p.text ? await has(p.text) : true;
      const gone = p.textGone ? (await has(p.textGone)) === false : true;
      if (shown && gone) break;
      if (Date.now() > deadline) {
        throw new Error(`Timed out after ${timeout}s waiting for ${p.text ? `"${p.text}" to appear` : `"${p.textGone}" to disappear`}.`);
      }
      await delay(250);
    }
    return this.result(tab, p);
  }

  screenshot(p: { ref?: string; fullPage?: boolean; annotate?: boolean } = {}): Promise<ScreenshotResult> {
    return this.capture(this.requireTab(), p);
  }

  console(since = 0, limit = 100): ConsoleResult {
    return this.requireTab(true).console(since, limit);
  }

  network(since = 0, limit = 100, filter?: string): NetworkResult {
    return this.requireTab(true).network(since, limit, filter);
  }

  evaluate<T = unknown>(expression: string): Promise<T> {
    return this.evaluateIn<T>(this.requireTab(), expression);
  }

  get lastSelection(): PickedElement | undefined {
    return this.selection;
  }

  get isPicking() {
    return !!this.picking;
  }

  /** Let the user click an element in the active tab. Resolves undefined on Escape, navigation or timeout. */
  pick(timeoutMs = PICK_TIMEOUT_MS): Promise<PickedElement | undefined> {
    const tab = this.requireTab();
    this.picking ??= this.runPicker(tab, timeoutMs).finally(() => {
      this.picking = undefined;
    });
    return this.picking;
  }

  async cancelPick() {
    const tab = this.activeTab;
    if (tab) await this.evaluateOnce(tab, invoke(stopPicker)).catch(() => {});
  }

  async stop() {
    const roots = [...this.tabs.values()].map(t => t.rootSession);
    for (const id of [...this.tabs.keys()]) this.removeTab(id);
    await Promise.all(roots.map(r => Promise.race([vscode.debug.stopDebugging(r), delay(1500)]).catch(() => {})));
  }

  dispose() {
    void this.stop();
    for (const d of this.disposables) d.dispose();
  }

  private removeTab(id: string) {
    const tab = this.tabs.get(id);
    if (!tab) return;
    this.tabs.delete(id);
    tab.dispose();
    if (this.activeId === id) this.activeId = [...this.tabs.keys()].pop();
    this.changeEmitter.fire(this.shared);
  }

  private requireTab(allowDialog = false): BrowserTab {
    const tab = this.activeTab;
    if (!tab) {
      throw new Error(
        'No browser tab is shared. Call browser_open with a URL, or ask the user to run "H/Ai: Share Browser Tab with Agent".',
      );
    }
    if (tab.dialog && !allowDialog) throw dialogError(tab.dialog);
    return tab;
  }

  private launch(url: string) {
    return this.connect({ type: 'editor-browser', request: 'launch', url }).then(tab => this.waitForLoad(tab));
  }

  /** Attach to an already-open tab showing `url`, e.g. one VS Code restored after a window reload. */
  private async attachExisting(url: string): Promise<boolean> {
    if (browserTabCount() === 0) return false;
    // js-debug attaches directly when exactly one tab matches urlFilter; otherwise it shows a
    // tab picker, which we dismiss so that the caller opens a new tab instead.
    let attached = false;
    const started = vscode.debug.onDidStartDebugSession(s => {
      if (isOurPageSession(s)) attached = true;
    });
    const timer = setTimeout(() => {
      if (!attached) void vscode.commands.executeCommand('workbench.action.closeQuickOpen');
    }, ATTACH_PICKER_GRACE_MS);
    try {
      await this.connect({ type: 'editor-browser', request: 'attach', urlFilter: url });
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
      started.dispose();
    }
  }

  private async connect(config: { type: string; request: string; [key: string]: unknown }): Promise<BrowserTab> {
    while (this.connecting) await this.connecting.catch(() => {});
    const connecting = (async () => {
      const known = new Set([...this.tabs.values()].map(t => t.session.id));
      // A unique name per tab: VS Code renames sessions whose names collide.
      const name = `${SESSION_NAME} #${this.nextTabId}`;
      let root: vscode.DebugSession | undefined;
      const rootStarted = vscode.debug.onDidStartDebugSession(s => {
        if (s.name === name && !s.parentSession) root = s;
      });
      const sessionPromise = waitForPageSession(30_000, known, name);
      sessionPromise.catch(() => {});
      let session: vscode.DebugSession;
      try {
        const started = await vscode.debug.startDebugging(
          undefined,
          { ...config, name, internalConsoleOptions: 'neverOpen' },
          debugOptions,
        );
        if (!started) throw new Error('Could not start an integrated browser debug session.');
        session = await sessionPromise;
      } catch (e) {
        if (root) void vscode.debug.stopDebugging(root);
        throw e;
      } finally {
        rootStarted.dispose();
      }
      const address = await vscode.commands.executeCommand<CdpProxyAddress | undefined>(
        'extension.js-debug.requestCDPProxy',
        session.id,
      );
      if (!address) throw new Error('js-debug did not return a CDP proxy for the browser tab.');
      const cdp = await CdpClient.connect(`ws://${address.host}:${address.port}${address.path}`);
      const tab = new BrowserTab(`t${this.nextTabId++}`, session, cdp);
      cdp.on('close', () => this.removeTab(tab.id));
      await tab.init();
      this.tabs.set(tab.id, tab);
      this.activeId = tab.id;
      this.changeEmitter.fire(true);
      return tab;
    })();
    this.connecting = connecting;
    try {
      return await connecting;
    } finally {
      if (this.connecting === connecting) this.connecting = undefined;
    }
  }

  /** Run an input action, then report the page. If the action opens a JS dialog, return right away. */
  private async act(opts: ActionOptions, fn: (tab: BrowserTab) => Promise<void>): Promise<ActionResult> {
    const tab = this.requireTab();
    await tab.send('Page.bringToFront').catch(() => {});
    let sub: vscode.Disposable | undefined;
    const dialogOpened = new Promise<'dialog'>(resolve => {
      sub = tab.onDialog(() => resolve('dialog'));
    });
    try {
      const done = fn(tab).then(() => 'done' as const);
      const winner = await Promise.race([done, dialogOpened]);
      if (winner === 'dialog') done.catch(() => {});
      else {
        await this.evaluateOnce(tab, invoke(nextFrame, 200)).catch(() => {});
        await delay(100);
        await this.waitForLoad(tab, 5_000);
      }
    } finally {
      sub?.dispose();
    }
    return this.result(tab, opts);
  }

  private async result(tab: BrowserTab, opts: ActionOptions): Promise<ActionResult> {
    const res: ActionResult = { ok: true, url: tab.url, title: tab.title, tabId: tab.id };
    try {
      await this.refreshInfo(tab);
      Object.assign(res, { url: tab.url, title: tab.title });
      if (opts.snapshot !== false) {
        const s = await this.snapshotIn(tab);
        res.snapshot = s.tree;
        res.truncated = s.truncated;
      }
      if (opts.screenshot) res.screenshot = await this.capture(tab, {});
    } catch (e) {
      if (!tab.dialog) throw e;
    }
    if (tab.dialog) res.dialog = tab.dialog;
    return res;
  }

  private async refreshInfo(tab: BrowserTab) {
    const { url, title } = await this.evaluateIn<{ url: string; title: string }>(tab, '({ url: location.href, title: document.title })');
    tab.url = url;
    tab.title = title;
  }

  private snapshotIn(tab: BrowserTab): Promise<SnapshotResult> {
    return this.evaluateIn<SnapshotResult>(tab, invoke(snapshotPage, SNAPSHOT_MAX_LINES));
  }

  private viewport(tab: BrowserTab): Promise<Viewport> {
    return this.evaluateIn<Viewport>(tab, invoke(viewportInfo));
  }

  private async capture(tab: BrowserTab, p: { ref?: string; fullPage?: boolean; annotate?: boolean }): Promise<ScreenshotResult> {
    const params: Record<string, unknown> = { format: 'png' };
    let width: number | undefined;
    let height: number | undefined;
    let snapshot: string | undefined;
    await this.evaluateOnce(tab, invoke(setCursorVisible, false)).catch(() => {});
    if (p.annotate) {
      snapshot = (await this.snapshotIn(tab)).tree;
      await this.evaluateIn(tab, invoke(annotateRefs));
    }
    try {
      if (p.ref && !p.annotate) {
        const box = await this.locate(tab, p.ref, false);
        params.clip = { x: box.x + box.scrollX, y: box.y + box.scrollY, width: box.width, height: box.height, scale: 1 };
        params.captureBeyondViewport = true;
        ({ width, height } = box);
      } else if (p.fullPage && !p.annotate) {
        params.captureBeyondViewport = true;
        const metrics = await tab.send<{ cssContentSize: { width: number; height: number } }>('Page.getLayoutMetrics');
        params.clip = { x: 0, y: 0, ...metrics.cssContentSize, scale: 1 };
        ({ width, height } = metrics.cssContentSize);
      } else {
        const v = await this.viewport(tab);
        ({ width, height } = v);
        // Keep the image in CSS pixels so its coordinates can be passed straight to click/hover.
        if (v.dpr !== 1) params.clip = { x: v.scrollX, y: v.scrollY, width: v.width, height: v.height, scale: 1 / v.dpr };
      }
      const { data } = await tab.guard(tab.send<{ data: string }>('Page.captureScreenshot', params));
      return { mimeType: 'image/png', data, width: width && Math.round(width), height: height && Math.round(height), snapshot };
    } finally {
      if (p.annotate) await this.evaluateOnce(tab, invoke(removeAnnotations)).catch(() => {});
      await this.evaluateOnce(tab, invoke(setCursorVisible, true)).catch(() => {});
    }
  }

  private showCursor() {
    return vscode.workspace.getConfiguration('haiBrowser').get<boolean>('showAgentCursor', true);
  }

  /** Glide the visible agent cursor to where the next input lands, so the human can follow along. */
  private async glide(tab: BrowserTab, to: { x: number; y: number }) {
    if (!this.showCursor()) return;
    const from = tab.cursor ?? { x: to.x + 80, y: to.y + 60 };
    const ms = Math.round(Math.min(CURSOR_MAX_MS, Math.max(CURSOR_MIN_MS, Math.hypot(to.x - from.x, to.y - from.y) * 1.2)));
    tab.cursor = to;
    const shown = await this.evaluateOnce(tab, invoke(moveCursor, from.x, from.y, to.x, to.y, ms)).then(
      () => true,
      () => false,
    );
    if (shown) await delay(ms);
  }

  /** Resolve a target and glide the cursor there. Refs are re-measured after the glide in case the layout moved. */
  private async aim(tab: BrowserTab, target: PointTarget): Promise<{ x: number; y: number }> {
    const first = await this.point(tab, target);
    await this.glide(tab, first);
    if (!target.ref || !this.showCursor()) return first;
    const at = await this.point(tab, target);
    if (Math.hypot(at.x - first.x, at.y - first.y) > 1) await this.glide(tab, at);
    return at;
  }

  private async ripple(tab: BrowserTab, at: { x: number; y: number }) {
    if (this.showCursor()) await this.evaluateOnce(tab, invoke(cursorRipple, at.x, at.y)).catch(() => {});
  }

  private async point(tab: BrowserTab, target: PointTarget): Promise<{ x: number; y: number }> {
    if (target.ref) {
      const box = await this.locate(tab, target.ref, false);
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    }
    if (typeof target.x === 'number' && typeof target.y === 'number') return { x: target.x, y: target.y };
    throw new Error('Pass an element "ref" from the snapshot, or "x" and "y" viewport coordinates from a screenshot.');
  }

  private async runPicker(tab: BrowserTab, timeoutMs: number): Promise<PickedElement | undefined> {
    await tab.send('Page.bringToFront').catch(() => {});
    await this.evaluateIn(tab, invoke(startPicker));
    const deadline = Date.now() + timeoutMs;
    try {
      while (!tab.isClosed && Date.now() < deadline) {
        await delay(150);
        // Evaluation fails briefly while the page navigates; the next poll then reports "idle".
        const s = await this.evaluateOnce<PickState>(tab, invoke(pollPicker)).catch(() => undefined);
        if (!s || s.state === 'picking') continue;
        if (s.state !== 'picked' || !s.picked) return undefined;
        const picked = await toPickedElement(s.picked);
        this.selection = picked;
        this.pickEmitter.fire(picked);
        return picked;
      }
      return undefined;
    } finally {
      await this.evaluateOnce(tab, invoke(stopPicker)).catch(() => {});
    }
  }

  private async locate(tab: BrowserTab, ref: string, focus: boolean, clear = false): Promise<ElementBox> {
    const box = await this.evaluateIn<ElementBox | { error: string }>(tab, invoke(locateRef, ref, focus, clear));
    if ('error' in box) throw new Error(box.error);
    return box;
  }

  private async pressKey(tab: BrowserTab, combo: string) {
    const { key, modifiers: mods } = parseKeyCombo(combo);
    const modifiers = modifierBits(mods);
    const def = KEYS[key] ?? charKey(key);
    const chord = mods.some(m => m !== 'Shift');
    let text = chord ? undefined : (def.text ?? (key.length === 1 ? key : undefined));
    if (text && mods.includes('Shift') && key.length === 1) text = key.toUpperCase();
    // macOS needs editing commands for shortcuts such as Cmd+A; other platforms handle the chord natively.
    const commands =
      process.platform === 'darwin' && mods.includes('Meta') ? EDIT_COMMANDS[key.toLowerCase()] : undefined;
    const base = { key: def.key, code: def.code, windowsVirtualKeyCode: def.keyCode, nativeVirtualKeyCode: def.keyCode, modifiers };
    await tab.send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', ...base, text, unmodifiedText: text, commands });
    await tab.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  }

  private async waitForLoad(tab: BrowserTab, timeoutMs = 15_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && !tab.dialog) {
      const state = await this.evaluateOnce<string>(tab, 'document.readyState').catch(() => undefined);
      if (state === 'complete') return;
      await delay(150);
    }
  }

  private async evaluateIn<T>(tab: BrowserTab, expression: string, attempts = 5): Promise<T> {
    let lastError: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        return await this.evaluateOnce<T>(tab, expression);
      } catch (e) {
        lastError = e;
        // The execution context is replaced during navigation; give the new one a moment.
        if (!/context|destroyed|navigat/i.test(String(e))) throw e;
        await delay(200);
      }
    }
    throw lastError;
  }

  private async evaluateOnce<T>(tab: BrowserTab, expression: string): Promise<T> {
    const res = await tab.guard(
      tab.send<{ result: { value?: T }; exceptionDetails?: any }>('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
        userGesture: true,
      }),
    );
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.exception?.description ?? res.exceptionDetails.text ?? 'Evaluation failed');
    }
    return res.result.value as T;
  }
}

/** Close the integrated-browser editor tab with this title, when that identifies a single tab. */
async function closeEditorTab(title: string) {
  const matches = vscode.window.tabGroups.all.flatMap(g => g.tabs).filter(t => t.input === undefined && t.label === title);
  const tab = matches.length === 1 ? matches[0] : matches.find(t => t.isActive);
  if (tab) await vscode.window.tabGroups.close(tab).then(undefined, () => {});
}

function waitForPageSession(timeoutMs: number, known: Set<string>, rootName: string): Promise<vscode.DebugSession> {
  const isNew = (s: vscode.DebugSession | undefined): s is vscode.DebugSession => isOurPageSession(s) && !known.has(s!.id);
  if (isNew(vscode.debug.activeDebugSession)) return Promise.resolve(vscode.debug.activeDebugSession);
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
      if (isNew(s)) done(() => resolve(s));
    });
    const ended = vscode.debug.onDidTerminateDebugSession(s => {
      if (s.name === rootName && !s.parentSession) {
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

function charKey(key: string): { key: string; code: string; keyCode: number; text?: string } {
  if (/^[a-z]$/i.test(key)) return { key, code: `Key${key.toUpperCase()}`, keyCode: key.toUpperCase().charCodeAt(0) };
  if (/^[0-9]$/.test(key)) return { key, code: `Digit${key}`, keyCode: key.charCodeAt(0) };
  return { key, code: key, keyCode: 0 };
}

const EDIT_COMMANDS: Record<string, string[]> = {
  a: ['selectAll'],
  c: ['copy'],
  x: ['cut'],
  v: ['paste'],
  z: ['undo'],
};

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
