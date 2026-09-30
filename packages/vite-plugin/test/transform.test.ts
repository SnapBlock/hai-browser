import { describe, expect, it } from 'vitest';
import { tagJsxSource } from '../src/transform';

const tag = (code: string, id = '/app/src/App.tsx') => tagJsxSource(code, id, 'src/App.tsx')?.code;

describe('tagJsxSource', () => {
  it('tags intrinsic elements with 1-based line and column', () => {
    const out = tag(['export const A = () => (', '  <div className="x">', '    <button>Hi</button>', '  </div>', ');'].join('\n'));
    expect(out).toContain('<div data-hai-src="src/App.tsx:2:3" className="x">');
    expect(out).toContain('<button data-hai-src="src/App.tsx:3:5">Hi</button>');
  });

  it('tags self-closing elements', () => {
    expect(tag('const a = <input type="text" />;')).toContain('<input data-hai-src="src/App.tsx:1:11" type="text" />');
  });

  it('skips components, member expressions, namespaced tags and fragments', () => {
    const out = tag('const a = <><Card /><Foo.Bar /><svg:rect /></>;');
    expect(out).toBeUndefined();
  });

  it('keeps an existing data-hai-src', () => {
    expect(tag('const a = <div data-hai-src="x:1:1" />;')).toBeUndefined();
  });

  it('parses TypeScript syntax in .tsx files', () => {
    const out = tag('function f<T,>(x: T): JSX.Element { return <span>{x as any}</span>; }');
    expect(out).toContain('<span data-hai-src="src/App.tsx:1:');
  });

  it('parses plain .jsx files', () => {
    expect(tagJsxSource('const a = <p>hi</p>;', '/app/src/A.jsx', 'src/A.jsx')?.code).toContain(
      '<p data-hai-src="src/A.jsx:1:11">',
    );
  });

  it('ignores non-JSX files, node_modules and query suffixes', () => {
    expect(tagJsxSource('const a = 1 < 2;', '/app/src/a.ts', 'src/a.ts')).toBeNull();
    expect(tagJsxSource('const a = <p />;', '/app/node_modules/x/a.jsx', 'x')).toBeNull();
    expect(tagJsxSource('const a = <p />;', '/app/src/A.tsx?v=123', 'src/A.tsx')?.code).toContain('data-hai-src');
  });

  it('normalises Windows separators and returns a source map', () => {
    const res = tagJsxSource('const a = <p />;', 'C:/app/src/A.tsx', 'src\\A.tsx');
    expect(res?.code).toContain('data-hai-src="src/A.tsx:1:11"');
    expect(res?.map.mappings).toBeTruthy();
  });
});
