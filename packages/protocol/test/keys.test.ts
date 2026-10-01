import { describe, expect, it } from 'vitest';
import { modifierBits, parseKeyCombo } from '../src/index';

describe('parseKeyCombo', () => {
  it('parses plain keys', () => {
    expect(parseKeyCombo('Enter')).toEqual({ key: 'Enter', modifiers: [] });
    expect(parseKeyCombo('a')).toEqual({ key: 'a', modifiers: [] });
    expect(parseKeyCombo('+')).toEqual({ key: '+', modifiers: [] });
  });
  it('parses chords and aliases', () => {
    expect(parseKeyCombo('Control+Shift+ArrowLeft')).toEqual({ key: 'ArrowLeft', modifiers: ['Control', 'Shift'] });
    expect(parseKeyCombo('cmd+a')).toEqual({ key: 'a', modifiers: ['Meta'] });
    expect(parseKeyCombo('Control++')).toEqual({ key: '+', modifiers: ['Control'] });
  });
  it('rejects unknown modifiers', () => {
    expect(() => parseKeyCombo('Hyper+a')).toThrow(/Unknown modifier/);
  });
});

describe('modifierBits', () => {
  it('matches CDP modifier flags', () => {
    expect(modifierBits(['Alt', 'Shift'])).toBe(9);
    expect(modifierBits(['Control', 'Meta'])).toBe(6);
    expect(modifierBits()).toBe(0);
  });
});
