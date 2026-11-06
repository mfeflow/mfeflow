import * as fc from 'fast-check';
import { MfeflowError } from '@mfeflow/core';
import { describe, expect, it } from 'vitest';
import { parsePreset } from './preset';

const attempt = (value: unknown) => {
  try {
    return { preset: parsePreset('preset.json', value) };
  } catch (error) {
    if (error instanceof MfeflowError && error.code === 'MFEFLOW_E109') return { error };
    throw error;
  }
};

describe('parsePreset fuzz', () => {
  it('returns a preset or throws E109, never anything else, for any JSON value', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        attempt(value);
      }),
      { numRuns: 500 },
    );
  });

  it('rejects every object that holds a key it does not know', () => {
    const known = new Set([
      '$schema',
      'kind',
      'scope',
      'remotes',
      'features',
      'packages',
      'packageManager',
      'topology',
      'bundler',
      'options',
    ]);
    fc.assert(
      fc.property(
        fc.string().filter((key) => !known.has(key) && key !== '__proto__'),
        fc.jsonValue(),
        (key, item) => {
          expect(attempt({ [key]: item }).error).toBeDefined();
        },
      ),
      { numRuns: 300 },
    );
  });

  it('returns exactly the text it was given for a valid preset', () => {
    const texts = fc.array(fc.string(), { maxLength: 4 });
    fc.assert(
      fc.property(fc.string(), texts, texts, (scope, remotes, features) => {
        const { preset, error } = attempt({ scope, remotes, features });
        expect(error).toBeUndefined();
        expect(preset).toEqual({ scope, remotes, features });
      }),
      { numRuns: 200 },
    );
  });

  it('rejects lists that hold anything but text', () => {
    const notText = fc.jsonValue().filter((item) => typeof item !== 'string');
    fc.assert(
      fc.property(fc.constantFrom('remotes', 'features', 'packages'), notText, (key, item) => {
        expect(attempt({ [key]: [item] }).error).toBeDefined();
      }),
      { numRuns: 200 },
    );
  });
});
