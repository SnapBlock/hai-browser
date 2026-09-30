import { describe, expect, it } from 'vitest';
import { addSourceTagging, LOADER, withHaiBrowser } from '../src/index.js';

const ctx = { defaultConfig: {} };
const rule = { condition: { not: 'foreign' }, loaders: [LOADER] };

describe('withHaiBrowser', () => {
  it('only changes the config under next dev', async () => {
    const base = { reactStrictMode: true };
    expect(await withHaiBrowser(base)('phase-production-build', ctx)).toBe(base);
    const dev = await withHaiBrowser(base)('phase-development-server', ctx);
    expect(dev.reactStrictMode).toBe(true);
    expect(dev.turbopack?.rules?.['*.tsx']).toEqual(rule);
  });

  it('accepts a config function', async () => {
    const dev = await withHaiBrowser(async phase => ({ env: { PHASE: phase } }))('phase-development-server', ctx);
    expect(dev.env).toEqual({ PHASE: 'phase-development-server' });
    expect(dev.turbopack?.rules?.['*.jsx']).toEqual(rule);
  });
});

describe('addSourceTagging', () => {
  it('runs before existing Turbopack rules and keeps unrelated ones', () => {
    const svg = { loaders: ['@svgr/webpack'], as: '*.js' };
    const mine = { loaders: ['my-loader'] };
    const out = addSourceTagging({ turbopack: { rules: { '*.svg': svg, '*.tsx': mine } } });
    expect(out.turbopack!.rules!['*.svg']).toBe(svg);
    expect(out.turbopack!.rules!['*.tsx']).toEqual([rule, mine]);
  });

  it('adds a pre loader in webpack dev only and still calls the user webpack()', () => {
    const calls: boolean[] = [];
    const out = addSourceTagging({
      webpack: (cfg, { dev }) => {
        calls.push(dev);
        return cfg;
      }
    });
    const run = (dev: boolean) => {
      const cfg = { module: { rules: [] as unknown[] } };
      out.webpack!(cfg, { dev } as never);
      return cfg.module.rules;
    };
    expect(run(true)).toEqual([{ test: /\.[jt]sx$/, exclude: /node_modules/, enforce: 'pre', use: [LOADER] }]);
    expect(run(false)).toEqual([]);
    expect(calls).toEqual([true, false]);
  });
});
