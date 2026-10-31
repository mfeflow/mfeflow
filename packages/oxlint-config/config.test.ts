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

  it('forbids extensions on relative code imports only', () => {
    const dir = path.join(tmp, 'extensions');
    fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'pkg', 'scripts'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.oxlintrc.json'),
      JSON.stringify({ extends: ['../../oxlintrc.json'] }),
    );
    const imports = [
      "import a from './a.js';",
      "import b from './b.ts';",
      "import c from './c';",
      "import d from './hero.jpg';",
      "import './x.scss';",
      "import e from './font.woff2';",
      "import f from './data.json';",
      "import g from 'react-dom/client';",
    ];
    fs.writeFileSync(
      path.join(dir, 'x.ts'),
      `${imports.join('\n')}\nexport { a, b, c, d, e, f, g };\n`,
    );
    fs.writeFileSync(path.join(dir, 'bin', 'run.js'), "import a from '../a.js';\nexport { a };\n");
    fs.writeFileSync(
      path.join(dir, 'pkg', 'scripts', 'task.ts'),
      "import a from '../a.ts';\nexport { a };\n",
    );
    const r = spawnSync(
      process.execPath,
      [
        oxlint,
        '--no-ignore',
        '-c',
        path.join(dir, '.oxlintrc.json'),
        path.join(dir, 'x.ts'),
        path.join(dir, 'bin', 'run.js'),
        path.join(dir, 'pkg', 'scripts', 'task.ts'),
      ],
      {
        encoding: 'utf8',
        cwd: dir,
      },
    );
    const flagged = (r.stdout + r.stderr)
      .split('\n')
      .filter((line) => line.includes('import(extensions)'))
      .map((line) => line.replace(/^.*?([\w.-]+):(\d+):\d+:.*$/, '$1:$2'));
    expect(flagged.toSorted((a, b) => a.localeCompare(b))).toEqual(['x.ts:1', 'x.ts:2']);
  }, 60_000);
});
