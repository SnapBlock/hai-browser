import type { NextConfig } from 'next';

export const LOADER = 'hai-browser-next/loader';
const DEV_PHASE = 'phase-development-server';

type Ctx = { defaultConfig: NextConfig };
export type NextConfigInput = NextConfig | ((phase: string, ctx: Ctx) => NextConfig | Promise<NextConfig>);

/** Wrap your Next.js config. Source tagging is only added under `next dev`. */
export function withHaiBrowser(input: NextConfigInput = {}) {
  return async (phase: string, ctx: Ctx): Promise<NextConfig> => {
    const config = typeof input === 'function' ? await input(phase, ctx) : input;
    return phase === DEV_PHASE ? addSourceTagging(config) : config;
  };
}

type Rules = NonNullable<NonNullable<NextConfig['turbopack']>['rules']>;

export function addSourceTagging(config: NextConfig): NextConfig {
  const rule = { condition: { not: 'foreign' }, loaders: [LOADER] } as const;
  const rules: Rules = { ...config.turbopack?.rules };
  for (const glob of ['*.jsx', '*.tsx']) {
    const existing = rules[glob];
    rules[glob] = (existing ? [rule, ...(Array.isArray(existing) ? existing : [existing])] : rule) as Rules[string];
  }
  const userWebpack = config.webpack;
  return {
    ...config,
    turbopack: { ...config.turbopack, rules },
    webpack(wp, options) {
      if (options.dev) {
        wp.module.rules.unshift({ test: /\.[jt]sx$/, exclude: /node_modules/, enforce: 'pre', use: [LOADER] });
      }
      return userWebpack ? userWebpack(wp, options) : wp;
    }
  };
}
