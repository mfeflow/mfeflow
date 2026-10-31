import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { binPath } from './bin';

const here = import.meta.dirname;
const tmp = path.join(here, '__fixture__');
const tsc = binPath('typescript', 'tsc', path.resolve(here, '../..'));

function project(name: string, preset: string, files: Record<string, string>): string {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'tsconfig.json'),
    JSON.stringify({ extends: `../../${preset}`, include: ['*.ts', '*.tsx'] }),
  );
  for (const [file, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, file), body);
  return dir;
}

function typecheck(dir: string): { status: number | null; out: string } {
  const r = spawnSync(process.execPath, [tsc, '-p', dir, '--noEmit', '--pretty', 'false'], {
    encoding: 'utf8',
  });
  return { status: r.status, out: r.stdout + r.stderr };
}

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('@mfeflow/tsconfig presets', () => {
  it('react-app compiles JSX against React types', () => {
    const dir = project('app', 'react-app.json', {
      'app.tsx': 'export function App() {\n  return <p>hello</p>;\n}\n',
    });
    expect(typecheck(dir)).toMatchObject({ status: 0 });
  }, 60_000);

  it('base is strict: unchecked index access and wrong types fail', () => {
    const dir = project('strict', 'base.json', {
      'a.ts':
        "const xs: string[] = [];\nexport const first: string = xs[0];\nexport const n: number = 'a';\n",
    });
    const r = typecheck(dir);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain('TS2322');
  }, 60_000);
});
