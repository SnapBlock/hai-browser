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
    if (truncated || SKIP.has(el.tagName) || !isVisible(el)) return;
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
  el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' as ScrollBehavior });
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
