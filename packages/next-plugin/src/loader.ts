import { relative } from 'node:path';
import { tagJsxSource } from '../../vite-plugin/src/transform.js';

interface LoaderContext {
  resourcePath: string;
  rootContext?: string;
  callback(err: Error | null, code?: string, map?: unknown): void;
}

export default function haiBrowserLoader(this: LoaderContext, code: string, map?: unknown) {
  const root = this.rootContext || process.cwd();
  const out = tagJsxSource(code, this.resourcePath, relative(root, this.resourcePath), root);
  if (!out) return this.callback(null, code, map);
  this.callback(null, out.code, out.map);
}
