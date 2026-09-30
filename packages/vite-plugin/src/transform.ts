import { parse, type ParserPlugin } from '@babel/parser';
import MagicString from 'magic-string';

export const SRC_ATTR = 'data-hai-src';
export const ROOT_ATTR = 'data-hai-root';

const JSX_FILE = /\.[jt]sx$/;

interface Node {
  type: string;
  start?: number | null;
  end?: number | null;
  loc?: { start: { line: number; column: number } } | null;
  [key: string]: unknown;
}

/**
 * Add `data-hai-src="file:line:column"` to every intrinsic JSX element (`<div>`, `<button>`, ...).
 * Components are skipped because they may not forward unknown props to the DOM.
 */
/** `root`, if given, is added to the `<html>` element so paths can be resolved without a meta tag. */
export function tagJsxSource(code: string, id: string, relativePath: string, root?: string) {
  const file = id.split('?', 1)[0]!;
  if (!JSX_FILE.test(file) || file.includes('/node_modules/') || !code.includes('<')) return null;

  const plugins: ParserPlugin[] = file.endsWith('.tsx') ? ['jsx', 'typescript'] : ['jsx'];
  const ast = parse(code, { sourceType: 'module', plugins, errorRecovery: true });
  const s = new MagicString(code);
  const path = relativePath.replace(/\\/g, '/').replace(/"/g, '&quot;');

  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (!node || typeof node !== 'object' || typeof (node as Node).type !== 'string') return;
    const n = node as Node;
    if (n.type === 'JSXOpeningElement') tag(n);
    for (const key in n) {
      if (key !== 'loc' && key !== 'leadingComments' && key !== 'trailingComments') visit(n[key]);
    }
  };

  const tag = (el: Node) => {
    const name = el.name as Node;
    if (name.type !== 'JSXIdentifier' || !/^[a-z]/.test(name.name as string)) return;
    const attrs = el.attributes as Node[];
    if (attrs.some(a => a.type === 'JSXAttribute' && (a.name as Node).name === SRC_ATTR)) return;
    const { line, column } = el.loc!.start;
    let attr = ` ${SRC_ATTR}="${path}:${line}:${column + 1}"`;
    if (root && name.name === 'html') attr += ` ${ROOT_ATTR}="${root.replace(/\\/g, '/').replace(/"/g, '&quot;')}"`;
    s.appendLeft(name.end!, attr);
  };

  visit(ast.program);
  if (!s.hasChanged()) return null;
  return { code: s.toString(), map: s.generateMap({ hires: true, source: file, includeContent: true }) };
}
