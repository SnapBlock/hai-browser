import { describe, expect, it } from 'vitest';
import { parseSourceTag } from '../src/index';

describe('parseSourceTag', () => {
  it('parses path, line and column', () => {
    expect(parseSourceTag('src/App.tsx:12:7')).toEqual({ path: 'src/App.tsx', line: 12, column: 7 });
  });
  it('keeps colons inside the path', () => {
    expect(parseSourceTag('C:/app/src/A.tsx:3:1')).toEqual({ path: 'C:/app/src/A.tsx', line: 3, column: 1 });
  });
  it('rejects malformed values', () => {
    expect(parseSourceTag('src/App.tsx')).toBeUndefined();
    expect(parseSourceTag('src/App.tsx:x:1')).toBeUndefined();
  });
});
