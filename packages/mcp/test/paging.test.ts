import { describe, expect, it } from 'vitest';
import { pageOf } from '../src/paging';

describe('pageOf', () => {
  const tree = ['- a', '- bb', '- ccc', '- dddd'].join('\n');

  it('returns everything when it fits', () => {
    expect(pageOf(tree, 0, 100)).toEqual({ text: tree });
  });

  it('cuts at the last line break and points at the next line', () => {
    const first = pageOf(tree, 0, 10);
    expect(first).toEqual({ text: '- a\n- bb', next: 9 });
    const second = pageOf(tree, first.next!, 10);
    expect(second).toEqual({ text: '- ccc', next: 15 });
    expect(pageOf(tree, second.next!, 10)).toEqual({ text: '- dddd' });
  });

  it('hard-cuts a single line longer than the limit', () => {
    expect(pageOf('x'.repeat(25), 0, 10)).toEqual({ text: 'x'.repeat(10), next: 10 });
  });

  it('clamps offsets outside the text', () => {
    expect(pageOf(tree, -5, 100)).toEqual({ text: tree });
    expect(pageOf(tree, 999, 100)).toEqual({ text: '' });
  });
});
