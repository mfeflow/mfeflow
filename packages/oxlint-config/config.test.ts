import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { binPath } from './bin';

const here = import.meta.dirname;
const tmp = path.join(here, '__fixture__');
const oxlint = binPath('oxlint', 'oxlint', path.resolve(here, '../..'));

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('@mfeflow/oxlint-config', () => {
  it('runs type-aware rules from the shared config', () => {
    fs.mkdirSync(tmp, { recursive: true });
    fs.writeFileSync(
      path.join(tmp, '.oxlintrc.json'),
      JSON.stringify({ extends: ['../oxlintrc.json'] }),
    );
    fs.writeFileSync(
      path.join(tmp, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          module: 'ESNext',
          moduleResolution: 'bundler',
          target: 'ES2022',
        },
        include: ['*.ts'],
      }),
    );
    fs.writeFileSync(
      path.join(tmp, 'a.ts'),
      'export async function f(): Promise<number> {\n  return 1;\n}\nexport function g(): void {\n  f();\n}\n',
    );
    const r = spawnSync(
      process.execPath,
      [
        oxlint,
        '--type-aware',
        '--no-ignore',
        '-c',
        path.join(tmp, '.oxlintrc.json'),
        path.join(tmp, 'a.ts'),
      ],
      { encoding: 'utf8', cwd: tmp },
    );
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toContain('no-floating-promises');
  }, 60_000);
});
