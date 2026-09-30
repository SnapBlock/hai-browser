import { describe, expect, it } from 'vitest';
import loader from '../src/loader.js';

function run(code: string, resourcePath: string, rootContext = '/proj') {
  let result: { code?: string; map?: unknown } = {};
  loader.call({ resourcePath, rootContext, callback: (_e, c, m) => (result = { code: c, map: m }) }, code);
  return result;
}

describe('loader', () => {
  it('tags JSX relative to the Next.js project root and marks <html> with the root', () => {
    const out = run('export default () => <html><body><h1>Hi</h1></body></html>;', '/proj/app/layout.tsx');
    expect(out.code).toContain('<html data-hai-src="app/layout.tsx:1:22" data-hai-root="/proj">');
    expect(out.code).toContain('<h1 data-hai-src="app/layout.tsx:1:34">');
    expect(out.map).toBeTruthy();
  });

  it('passes other files through unchanged', () => {
    const code = 'export const x = 1 < 2;';
    expect(run(code, '/proj/lib/x.ts').code).toBe(code);
  });
});
