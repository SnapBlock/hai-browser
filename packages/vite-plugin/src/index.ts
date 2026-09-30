import { relative } from 'node:path';
import type { Plugin } from 'vite';
import { tagJsxSource } from './transform.js';

export { ROOT_ATTR, SRC_ATTR, tagJsxSource } from './transform.js';

/** Meta tag the H/Ai extension reads to resolve `data-hai-src` paths back to files on disk. */
export const ROOT_META = 'hai-browser-root';

/**
 * Dev-server-only plugin: tags JSX elements with `data-hai-src="src/App.tsx:12:7"` so the
 * H/Ai VS Code extension can open the code behind an element picked in the browser.
 * Production builds are untouched.
 */
export default function haiBrowser(): Plugin {
  let root = process.cwd();
  return {
    name: 'hai-browser',
    enforce: 'pre',
    apply: 'serve',
    configResolved(config) {
      root = config.root;
    },
    transform(code, id) {
      const file = id.split('?', 1)[0]!;
      return tagJsxSource(code, id, relative(root, file));
    },
    transformIndexHtml() {
      return [{ tag: 'meta', attrs: { name: ROOT_META, content: root }, injectTo: 'head' }];
    },
  };
}
