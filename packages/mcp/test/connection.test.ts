import { describe, expect, it } from 'vitest';
import type { Lockfile } from '@hai-browser/protocol';
import { pickLockfile } from '../src/connection';

const lock = (pid: number, folders: string[], startedAt = pid): Lockfile => ({
  pid,
  port: 1000 + pid,
  token: 't',
  workspaceFolders: folders,
  startedAt,
});

describe('pickLockfile', () => {
  const alive = () => true;

  it('prefers the window whose workspace contains cwd', () => {
    const locks = [lock(1, ['/work/other'], 99), lock(2, ['/work/app'])];
    expect(pickLockfile(locks, '/work/app/src', alive)?.pid).toBe(2);
  });

  it('picks the most specific workspace folder', () => {
    const locks = [lock(1, ['/work']), lock(2, ['/work/app'])];
    expect(pickLockfile(locks, '/work/app', alive)?.pid).toBe(2);
  });

  it('does not treat sibling prefixes as containing cwd', () => {
    const locks = [lock(1, ['/work/app']), lock(2, ['/elsewhere'], 50)];
    expect(pickLockfile(locks, '/work/app-2', alive)?.pid).toBe(2);
  });

  it('falls back to the newest live window', () => {
    const locks = [lock(1, ['/a'], 10), lock(2, ['/b'], 20), lock(3, ['/c'], 30)];
    expect(pickLockfile(locks, '/x', pid => pid !== 3)?.pid).toBe(2);
  });

  it('returns undefined when nothing is running', () => {
    expect(pickLockfile([lock(1, ['/a'])], '/a', () => false)).toBeUndefined();
  });
});
