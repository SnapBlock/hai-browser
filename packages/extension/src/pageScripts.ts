// Scripts evaluated inside the shared page. Kept as plain functions so they can be
// serialized with `Function.prototype.toString` and run through Runtime.evaluate.

declare global {
  interface Window {
    __hai?: { next: number; ids: WeakMap<Element, string>; refs: Map<string, WeakRef<Element>> };
  }
}

export interface PageSnapshot {
  url: string;
  title: string;
  tree: string;
  truncated: boolean;
}

export function snapshotPage(maxLines: number): PageSnapshot {
  const hai = (window.__hai ??= { next: 1, ids: new WeakMap(), refs: new Map() });
  hai.refs.clear();
  const lines: string[] = [];
  let truncated = false;

  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'META', 'LINK']);
  const INTERACTIVE =
    'a[href],button,input,select,textarea,summary,[role=button],[role=link],[role=checkbox],' +
    '[role=radio],[role=tab],[role=menuitem],[role=switch],[role=option],[role=combobox],' +
    '[contenteditable=""],[contenteditable=true],[onclick],[tabindex]:not([tabindex="-1"])';
  const LANDMARK: Record<string, string> = {
    HEADER: 'banner', NAV: 'navigation', MAIN: 'main', FOOTER: 'contentinfo', ASIDE: 'complementary',
    FORM: 'form', DIALOG: 'dialog', UL: 'list', OL: 'list', TABLE: 'table',
  };

  const clean = (s: string | null | undefined, max = 120) => {
    const t = (s ?? '').replace(/\s+/g, ' ').trim();
    return t.length > max ? t.slice(0, max - 1) + '…' : t;
  };
  const isVisible = (el: Element) => {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    if (el.getClientRects().length === 0 && style.display !== 'contents') return false;
    return true;
  };
  const refFor = (el: Element) => {
    let ref = hai.ids.get(el);
    if (!ref) {
      ref = 'e' + hai.next++;
      hai.ids.set(el, ref);
    }
    hai.refs.set(ref, new WeakRef(el));
    return ref;
  };
  const roleOf = (el: Element): string => {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit;
    const tag = el.tagName;
    if (/^H[1-6]$/.test(tag)) return 'heading';
    if (tag === 'A') return 'link';
    if (tag === 'BUTTON' || tag === 'SUMMARY') return 'button';
    if (tag === 'SELECT') return 'combobox';
    if (tag === 'TEXTAREA') return 'textbox';
    if (tag === 'IMG') return 'img';
    if (tag === 'LI') return 'listitem';
    if (tag === 'INPUT') {
      const type = (el as HTMLInputElement).type;
      if (type === 'checkbox' || type === 'radio') return type;
      if (type === 'submit' || type === 'button' || type === 'reset') return 'button';
      return 'textbox';
    }
    if (tag === 'SECTION' && (el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby'))) return 'region';
    return LANDMARK[tag] ?? '';
  };
  const nameOf = (el: Element): string => {
    const aria = el.getAttribute('aria-label');
    if (aria) return clean(aria);
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const text = labelledBy.split(/\s+/).map(id => document.getElementById(id)?.textContent ?? '').join(' ');
      if (clean(text)) return clean(text);
    }
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
      const label = el.labels?.[0];
      if (label) return clean(label.textContent);
      if ('placeholder' in el && el.placeholder) return clean(el.placeholder);
    }
    if (el instanceof HTMLImageElement) return clean(el.alt);
    return clean((el as HTMLElement).innerText ?? el.textContent);
  };
  const details = (el: Element): string => {
    const parts: string[] = [];
    if (el instanceof HTMLInputElement) {
      if (el.type === 'checkbox' || el.type === 'radio') parts.push(el.checked ? 'checked' : 'unchecked');
      else if (el.type === 'password') parts.push(el.value ? 'value=<redacted>' : 'empty');
      else if (/^cc-/.test(el.autocomplete)) parts.push('value=<redacted>');
      else if (el.value) parts.push(`value="${clean(el.value, 80)}"`);
    } else if (el instanceof HTMLTextAreaElement && el.value) {
      parts.push(`value="${clean(el.value, 80)}"`);
    } else if (el instanceof HTMLSelectElement) {
      parts.push(`value="${clean(el.selectedOptions[0]?.textContent, 80)}"`);
    }
    if ((el as HTMLButtonElement).disabled) parts.push('disabled');
    if (el instanceof HTMLAnchorElement && el.getAttribute('href')) parts.push(`href="${clean(el.getAttribute('href'), 100)}"`);
    const src = el.closest('[data-hai-src]')?.getAttribute('data-hai-src');
    if (src) parts.push(`src=${src}`);
    return parts.length ? ' ' + parts.join(' ') : '';
  };
  const push = (depth: number, line: string) => {
    if (lines.length >= maxLines) {
      truncated = true;
      return false;
    }
    lines.push('  '.repeat(depth) + '- ' + line);
    return true;
  };

  const walk = (el: Element, depth: number): void => {
    if (truncated || SKIP.has(el.tagName) || el.hasAttribute('data-hai-ui')) return;
    if (!isVisible(el)) {
      // File inputs are usually hidden behind a styled button; agents still need a ref for browser_upload_file.
      if (el instanceof HTMLInputElement && el.type === 'file') push(depth, `file-input "${nameOf(el)}" [ref=${refFor(el)}] hidden`);
      // Custom checkboxes/radios hide the input and style its label; the ref points at the label so clicks land on it.
      if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
        const label = Array.from(el.labels ?? []).find(isVisible);
        if (label) push(depth, `${el.type} "${nameOf(el)}" [ref=${refFor(label)}]${details(el)}`);
      }
      return;
    }
    const interactive = el.matches(INTERACTIVE);
    const role = roleOf(el);
    let childDepth = depth;
    if (interactive) {
      push(depth, `${role || el.tagName.toLowerCase()} "${nameOf(el)}" [ref=${refFor(el)}]${details(el)}`);
      return;
    }
    if (role === 'heading') {
      push(depth, `heading "${nameOf(el)}" [level=${el.tagName.slice(1)}]`);
      return;
    }
    if (role === 'img') {
      push(depth, `img "${nameOf(el)}"`);
      return;
    }
    if (role) {
      const name = el.getAttribute('aria-label');
      push(depth, role + (name ? ` "${clean(name)}"` : '') + ':');
      childDepth = depth + 1;
    }
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = clean(node.textContent, 200);
        if (text) push(childDepth, `text: ${JSON.stringify(text)}`);
      } else if (node instanceof Element) {
        walk(node, childDepth);
      }
      if (truncated) return;
    }
    if (el.shadowRoot) for (const child of Array.from(el.shadowRoot.children)) walk(child, childDepth);
  };

  if (document.body) walk(document.body, 0);
  return { url: location.href, title: document.title, tree: lines.join('\n'), truncated };
}

export interface ElementBox {
  x: number;
  y: number;
  width: number;
  height: number;
  scrollX: number;
  scrollY: number;
}

export function locateRef(ref: string, focus: boolean, clear: boolean): ElementBox | { error: string } {
  const el = window.__hai?.refs.get(ref)?.deref();
  if (!el || !el.isConnected) return { error: `Unknown or stale ref "${ref}". Take a new snapshot.` };
  el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' as ScrollBehavior });
  if (focus && el instanceof HTMLElement) {
    el.focus();
    if (clear && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) el.select();
  }
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height, scrollX: window.scrollX, scrollY: window.scrollY };
}

/** Build a `Runtime.evaluate` expression calling `fn` with JSON-serializable args. */
export function invoke(fn: (...args: any[]) => unknown, ...args: unknown[]): string {
  return `(${fn.toString()})(${args.map(a => JSON.stringify(a)).join(',')})`;
}

export interface PickState {
  state: 'picking' | 'picked' | 'cancelled' | 'idle';
  picked?: PageElementInfo;
}

export interface PageElementInfo {
  ref: string;
  tag: string;
  selector: string;
  text: string;
  html: string;
  styles: Record<string, string>;
  rect: { x: number; y: number; width: number; height: number };
  url: string;
  src?: string;
  srcRoot?: string;
}

declare global {
  interface Window {
    __haiPick?: { state: PickState['state']; picked?: PageElementInfo; stop: () => void };
  }
}

/** Hover-highlight elements; the next click is captured (not delivered to the page). Escape cancels. */
export function startPicker(): boolean {
  window.__haiPick?.stop();
  const hai = (window.__hai ??= { next: 1, ids: new WeakMap(), refs: new Map() });
  const box = document.createElement('div');
  const label = document.createElement('div');
  box.style.cssText =
    'position:fixed;z-index:2147483647;pointer-events:none;border:2px solid #7c3aed;background:rgba(124,58,237,.12);' +
    'border-radius:2px;transition:all 40ms;display:none';
  label.style.cssText =
    'position:fixed;z-index:2147483647;pointer-events:none;background:#7c3aed;color:#fff;font:12px/1.4 ui-monospace,monospace;' +
    'padding:2px 6px;border-radius:3px;white-space:nowrap;display:none';
  document.documentElement.append(box, label);

  let current: Element | null = null;
  const srcOf = (el: Element) => el.closest('[data-hai-src]')?.getAttribute('data-hai-src') ?? undefined;
  const show = (el: Element) => {
    current = el;
    const r = el.getBoundingClientRect();
    Object.assign(box.style, { display: 'block', left: r.x + 'px', top: r.y + 'px', width: r.width + 'px', height: r.height + 'px' });
    const src = srcOf(el);
    label.textContent = el.tagName.toLowerCase() + (src ? '  ' + src.split('/').pop() : '');
    Object.assign(label.style, { display: 'block', left: Math.max(0, r.x) + 'px', top: Math.max(0, r.y - 22) + 'px' });
  };
  const selectorOf = (el: Element) => {
    const parts: string[] = [];
    for (let e: Element | null = el; e && e !== document.documentElement && parts.length < 5; e = e.parentElement) {
      if (e.id) {
        parts.unshift('#' + CSS.escape(e.id));
        break;
      }
      let part = e.tagName.toLowerCase();
      const parent = e.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter(c => c.tagName === e!.tagName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(e) + 1})`;
      }
      parts.unshift(part);
    }
    return parts.join(' > ');
  };
  const describe = (el: Element): PageElementInfo => {
    let ref = hai.ids.get(el);
    if (!ref) {
      ref = 'e' + hai.next++;
      hai.ids.set(el, ref);
    }
    hai.refs.set(ref, new WeakRef(el));
    const cs = getComputedStyle(el);
    const styles: Record<string, string> = {};
    for (const p of ['display', 'position', 'color', 'background-color', 'font-family', 'font-size', 'font-weight',
      'line-height', 'padding', 'margin', 'border', 'border-radius', 'width', 'height', 'gap']) {
      styles[p] = cs.getPropertyValue(p);
    }
    const clone = el.cloneNode(true) as Element;
    for (const input of Array.from(clone.querySelectorAll('input[type=password],input[autocomplete^=cc-]'))) {
      input.setAttribute('value', '<redacted>');
    }
    const html = clone.outerHTML;
    const r = el.getBoundingClientRect();
    const text = ((el as HTMLElement).innerText ?? el.textContent ?? '').replace(/\s+/g, ' ').trim();
    return {
      ref,
      tag: el.tagName.toLowerCase(),
      selector: selectorOf(el),
      text: text.length > 300 ? text.slice(0, 299) + '…' : text,
      html: html.length > 3000 ? html.slice(0, 2999) + '…' : html,
      styles,
      rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      url: location.href,
      src: srcOf(el),
      srcRoot:
        document.querySelector('meta[name="hai-browser-root"]')?.getAttribute('content') ??
        document.documentElement.getAttribute('data-hai-root') ??
        undefined,
    };
  };

  const swallow = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  };
  const onMove = (e: MouseEvent) => {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (el && el !== box && el !== label && el !== current) show(el);
  };
  const onClick = (e: MouseEvent) => {
    swallow(e);
    const el = document.elementFromPoint(e.clientX, e.clientY) ?? current;
    if (!el) return;
    state.picked = describe(el);
    state.state = 'picked';
    stop();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    swallow(e);
    state.state = 'cancelled';
    stop();
  };
  const listeners: [string, EventListener][] = [
    ['mousemove', onMove as EventListener],
    ['click', onClick as EventListener],
    ['mousedown', swallow],
    ['mouseup', swallow],
    ['pointerdown', swallow],
    ['pointerup', swallow],
    ['keydown', onKey as EventListener],
  ];
  const stop = () => {
    for (const [type, fn] of listeners) window.removeEventListener(type, fn, true);
    box.remove();
    label.remove();
    document.documentElement.style.cursor = prevCursor;
    if (state.state === 'picking') state.state = 'cancelled';
  };
  const state: NonNullable<Window['__haiPick']> = { state: 'picking', stop };
  const prevCursor = document.documentElement.style.cursor;
  document.documentElement.style.cursor = 'crosshair';
  for (const [type, fn] of listeners) window.addEventListener(type, fn, true);
  window.__haiPick = state;
  return true;
}

export function pollPicker(): PickState {
  const p = window.__haiPick;
  if (!p) return { state: 'idle' };
  if (p.state === 'picking') return { state: 'picking' };
  window.__haiPick = undefined;
  return { state: p.state, picked: p.picked };
}

export function stopPicker(): boolean {
  window.__haiPick?.stop();
  window.__haiPick = undefined;
  return true;
}

export interface Viewport {
  dpr: number;
  width: number;
  height: number;
  scrollX: number;
  scrollY: number;
}

export function viewportInfo(): Viewport {
  return { dpr: devicePixelRatio, width: innerWidth, height: innerHeight, scrollX, scrollY };
}

export function pageHasText(text: string): boolean {
  return (document.body?.innerText ?? '').includes(text);
}

export function selectOption(ref: string, values: string[]): { selected: string[] } | { error: string } {
  const el = window.__hai?.refs.get(ref)?.deref();
  if (!el || !el.isConnected) return { error: `Unknown or stale ref "${ref}". Take a new snapshot.` };
  if (!(el instanceof HTMLSelectElement)) return { error: `Element ${ref} is not a <select>.` };
  const wanted = new Set(values);
  const options = Array.from(el.options);
  const label = (o: HTMLOptionElement) => (o.label || o.textContent || '').trim();
  let matched = options.filter(o => wanted.has(o.value) || wanted.has(label(o)));
  if (!matched.length) {
    return { error: `No option matches ${JSON.stringify(values)}. Options: ${options.map(o => JSON.stringify(label(o))).join(', ')}` };
  }
  if (!el.multiple) matched = matched.slice(0, 1);
  el.focus();
  for (const o of options) o.selected = matched.includes(o);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return { selected: matched.map(label) };
}

/** Draw each ref from the latest snapshot that is inside the viewport, for annotated screenshots. */
export function annotateRefs(): number {
  document.getElementById('__hai_marks')?.remove();
  const hai = window.__hai;
  if (!hai) return 0;
  const layer = document.createElement('div');
  layer.id = '__hai_marks';
  layer.setAttribute('data-hai-ui', '');
  layer.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none';
  let count = 0;
  for (const [ref, weak] of hai.refs) {
    const el = weak.deref();
    if (!el || !el.isConnected) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) continue;
    const box = document.createElement('div');
    box.style.cssText =
      `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;` +
      'border:1.5px solid #e11d48;border-radius:2px;box-sizing:border-box';
    const tag = document.createElement('div');
    tag.textContent = ref;
    tag.style.cssText =
      `position:fixed;left:${Math.max(0, r.left)}px;top:${Math.max(0, r.top - 14)}px;background:#e11d48;color:#fff;` +
      'font:bold 11px/14px ui-monospace,monospace;padding:0 3px;border-radius:2px;white-space:nowrap';
    layer.append(box, tag);
    count++;
  }
  document.documentElement.append(layer);
  return count;
}

export function removeAnnotations(): boolean {
  document.getElementById('__hai_marks')?.remove();
  return true;
}

/** Glide the agent's visible pointer from (fx, fy) to (x, y). Purely visual: it never receives events. */
export function moveCursor(fx: number, fy: number, x: number, y: number, ms: number): boolean {
  const place = (px: number, py: number) => `translate(${px - 2}px,${py - 2}px)`;
  let c = document.getElementById('__hai_cursor');
  if (!c) {
    c = document.createElement('div');
    c.id = '__hai_cursor';
    c.setAttribute('data-hai-ui', '');
    c.setAttribute('aria-hidden', 'true');
    c.style.cssText =
      'all:initial;position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;will-change:transform;' +
      'filter:drop-shadow(0 1px 2px rgba(0,0,0,.4))';
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', '20');
    svg.setAttribute('height', '24');
    svg.setAttribute('viewBox', '0 0 20 24');
    svg.style.cssText = 'display:block';
    const arrow = document.createElementNS(ns, 'path');
    arrow.setAttribute('d', 'M2 2v17.5l4.6-4.3 3.1 7 3.1-1.4-3-6.9h6.6z');
    arrow.setAttribute('fill', '#111827');
    arrow.setAttribute('stroke', '#fff');
    arrow.setAttribute('stroke-width', '1.5');
    arrow.setAttribute('stroke-linejoin', 'round');
    svg.append(arrow);
    const tag = document.createElement('span');
    tag.textContent = 'H/Ai';
    tag.style.cssText =
      'all:initial;position:absolute;left:15px;top:19px;background:#7c3aed;color:#fff;' +
      'font:600 10px/14px system-ui,sans-serif;padding:0 5px;border-radius:7px;white-space:nowrap';
    c.append(svg, tag);
    c.style.transform = place(fx, fy);
    document.documentElement.append(c);
  }
  c.style.visibility = '';
  c.style.transition = 'none';
  void c.offsetWidth;
  if (ms > 0) c.style.transition = `transform ${ms}ms cubic-bezier(.3,.7,.4,1)`;
  c.style.transform = place(x, y);
  return true;
}

/** A short ripple where the agent clicks. */
export function cursorRipple(x: number, y: number): boolean {
  const r = document.createElement('div');
  r.setAttribute('data-hai-ui', '');
  r.setAttribute('aria-hidden', 'true');
  r.style.cssText =
    `all:initial;position:fixed;left:${x - 14}px;top:${y - 14}px;width:28px;height:28px;box-sizing:border-box;` +
    'border-radius:50%;border:2px solid #7c3aed;background:rgba(124,58,237,.25);z-index:2147483646;pointer-events:none';
  document.documentElement.append(r);
  r.animate([{ transform: 'scale(.3)', opacity: 1 }, { transform: 'scale(1.5)', opacity: 0 }], {
    duration: 500,
    easing: 'ease-out',
    fill: 'forwards',
  });
  setTimeout(() => r.remove(), 600);
  return true;
}

export function setCursorVisible(visible: boolean): boolean {
  const c = document.getElementById('__hai_cursor');
  if (c) c.style.visibility = visible ? '' : 'hidden';
  return true;
}

/** Resolve after two rendered frames, so mouse moves Chromium queued for the next frame have been dispatched. */
export function nextFrame(timeoutMs: number): Promise<boolean> {
  return new Promise(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)));
    setTimeout(() => resolve(false), timeoutMs);
  });
}
