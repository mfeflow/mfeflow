// `mfeflow build` for real: generates a shell and a remote with `mfeflow init --local`, installs,
// runs `mfeflow build` from the root, and checks the output on disk. Once with Rsbuild, once with Vite.
// Then runs it again inside the remote's folder and with --only, and checks a missing install is refused.
//   node e2e/matrix/build.ts        (MATRIX_DIR picks where projects are generated; default: the OS temp folder)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repo = path.resolve(import.meta.dirname, '../..');
const cli = path.join(repo, 'packages/cli/bin/mfeflow.js');

function run(command: string, args: string[], cwd: string, capture = false) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
    shell: process.platform === 'win32' && command === 'pnpm',
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    out: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

const mfeflow = (args: string[], cwd: string, capture = false) =>
  run(process.execPath, [cli, ...args], cwd, capture);

/** The value under `keys` in parsed JSON, or undefined when the path is not there. */
function read(value: unknown, ...keys: string[]): unknown {
  let at = value;
  for (const key of keys) {
    if (typeof at !== 'object' || at === null) return undefined;
    at = Reflect.get(at, key);
  }
  return at;
}

function expectFile(file: string, problems: string[]): void {
  if (!fs.existsSync(file)) problems.push(`missing ${file}`);
}

function check(bundler: 'rsbuild' | 'vite', base: string): string[] {
  const work = fs.mkdtempSync(path.join(base, 'mfb-'));
  const project = path.join(work, 'app');
  const problems: string[] = [];
  try {
    const generate = mfeflow(
      [
        'init',
        'app',
        '--yes',
        '--no-install',
        '--local',
        repo,
        '--remotes',
        'catalog',
        '--bundler',
        bundler,
        '--cwd',
        work,
      ],
      work,
    );
    if (generate.status !== 0) return ['generate failed'];
    if (run('pnpm', ['install'], project).status !== 0) return ['install failed'];

    const built = mfeflow(['build', '--json'], project, true);
    if (built.status !== 0) return [`mfeflow build exited ${String(built.status)}:\n${built.out}`];
    const apps = read(JSON.parse(built.stdout), 'apps');
    if (!Array.isArray(apps) || apps.length !== 2) {
      problems.push(`expected 2 apps in the result, got ${built.stdout}`);
    } else {
      for (const app of apps) {
        const name = String(read(app, 'name'));
        if (read(app, 'status') !== 'built')
          problems.push(`${name} is ${String(read(app, 'status'))}`);
        if (typeof read(app, 'kb') !== 'number') problems.push(`${name} has no measured size`);
      }
    }

    const remote = path.join(project, 'apps/catalog/dist');
    expectFile(path.join(remote, 'mf-manifest.json'), problems);
    if (fs.existsSync(path.join(remote, 'mf-manifest.json'))) {
      const manifest: unknown = JSON.parse(
        fs.readFileSync(path.join(remote, 'mf-manifest.json'), 'utf8'),
      );
      const entry = read(manifest, 'metaData', 'remoteEntry');
      const name = String(read(entry, 'name'));
      const dir = String(read(entry, 'path'));
      expectFile(path.join(remote, dir, name), problems);
    }
    expectFile(path.join(project, 'apps/shell/dist/index.html'), problems);

    // Inside an app folder it builds just that app, in this process.
    fs.rmSync(remote, { recursive: true, force: true });
    const inside = mfeflow(['build'], path.join(project, 'apps/catalog'), true);
    if (inside.status !== 0)
      problems.push(`build inside the app exited ${String(inside.status)}:\n${inside.out}`);
    expectFile(path.join(remote, 'mf-manifest.json'), problems);

    // A bundler that is not installed is refused before anything builds.
    fs.rmSync(
      path.join(project, 'apps/catalog/node_modules', bundler === 'vite' ? 'vite' : '@rsbuild'),
      {
        recursive: true,
        force: true,
      },
    );
    const missing = mfeflow(['build', '--only', 'catalog'], project, true);
    if (missing.status !== 5 || !missing.out.includes('MFEFLOW_E308')) {
      problems.push(
        `a missing bundler should exit 5 with E308, got ${String(missing.status)}:\n${missing.out}`,
      );
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
  return problems;
}

const base = process.env.MATRIX_DIR ?? os.tmpdir();
fs.mkdirSync(base, { recursive: true });
const failures: string[] = [];
for (const bundler of ['rsbuild', 'vite'] as const) {
  console.log(`\n=== mfeflow build with ${bundler}`);
  const problems = check(bundler, base);
  console.log(
    problems.length === 0 ? `=== ${bundler}: ok` : `=== ${bundler}: FAILED\n${problems.join('\n')}`,
  );
  for (const problem of problems) failures.push(`${bundler}: ${problem}`);
}
if (failures.length > 0) process.exitCode = 1;
else console.log('\nbuild check passed');
