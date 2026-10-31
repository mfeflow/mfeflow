import { MfeflowError } from '@mfeflow/core';

export type FeatureOptions = Record<string, Record<string, unknown>>;

function value(raw: string): string | boolean {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return raw;
}

/** `--option feature.key=value` flags as `{ feature: { key: value } }`. `true` and `false` become booleans. */
export function parseFeatureOptions(flags: readonly string[]): FeatureOptions {
  const out: FeatureOptions = {};
  for (const flag of flags) {
    const equals = flag.indexOf('=');
    const dot = flag.indexOf('.');
    if (equals < 1 || dot < 1 || dot > equals - 1) {
      throw new MfeflowError('E107', `--option "${flag}" must look like feature.key=value`);
    }
    const feature = flag.slice(0, dot);
    const key = flag.slice(dot + 1, equals);
    (out[feature] ??= {})[key] = value(flag.slice(equals + 1));
  }
  return out;
}

/** `later` wins over `earlier`, key by key. */
export function mergeOptions(earlier: FeatureOptions, later: FeatureOptions): FeatureOptions {
  const out: FeatureOptions = {};
  for (const source of [earlier, later]) {
    for (const [feature, given] of Object.entries(source)) {
      out[feature] = { ...out[feature], ...given };
    }
  }
  return out;
}
