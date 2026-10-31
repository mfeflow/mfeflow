import { describe, expect, it } from 'vitest';
import type { TransformOp } from '@mfeflow/contracts';
import { thrown } from '../testing.js';
import { applyTransform } from './index.js';

describe('applyTransform', () => {
  it('dispatches each built-in op', () => {
    const cases: [string, string, TransformOp][] = [
      ['a.ts', '', { op: 'add-import', file: 'a.ts', from: 'x', named: ['y'] }],
      [
        'p.tsx',
        'export const Providers = () => <A />;\n',
        {
          op: 'wrap-provider',
          file: 'p.tsx',
          component: 'P',
          from: './p',
        },
      ],
      ['s.ts', 'export const singletons = [];\n', { op: 'add-shared', file: 's.ts', name: 'zod' }],
      [
        'b.tsx',
        'export async function main() {}\n',
        {
          op: 'add-boot-step',
          file: 'b.tsx',
          call: 'go',
          from: './go',
        },
      ],
      [
        'c.json',
        '{}',
        { op: 'add-env-key', file: 'c.json', key: 'K', scope: 'runtime', schema: 'z.string()' },
      ],
      [
        'r.ts',
        'export const routes = [];\n',
        {
          op: 'add-route',
          file: 'r.ts',
          path: '/x',
          component: 'X',
          from: './x',
        },
      ],
      [
        'ci.yml',
        'jobs:\n  t:\n    steps: []\n',
        {
          op: 'add-workflow-step',
          file: 'ci.yml',
          job: 't',
          step: { name: 'n', run: 'x' },
        },
      ],
    ];
    for (const [file, source, op] of cases) {
      const once = applyTransform(source, file, op);
      expect(once).not.toBe(source);
      expect(applyTransform(once, file, op)).toBe(once);
    }
  });

  it('rejects an op it does not know with E204', () => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- an op the types forbid, as a malformed feature.json would carry
    const op = { op: 'run-shell', file: 'a' } as unknown as TransformOp;
    expect(thrown(() => applyTransform('', 'a', op)).code).toBe('MFEFLOW_E204');
  });
});
