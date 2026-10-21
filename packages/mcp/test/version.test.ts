import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('version', () => {
  it('reports the package version to MCP clients', () => {
    const { version } = JSON.parse(read('../package.json'));
    expect(read('../src/index.ts')).toContain(`name: 'hai-browser', version: '${version}'`);
    expect(JSON.parse(read('../server.json')).version).toBe(version);
  });
});
