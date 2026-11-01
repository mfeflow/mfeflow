import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const pkg = path.resolve(import.meta.dirname, '..');
const repo = path.resolve(pkg, '../..');
const read = (file: string): string => fs.readFileSync(file, 'utf8');
const dockerfile = read(path.join(pkg, 'docker/Dockerfile'));
const compose = read(path.join(pkg, 'docker/compose.yaml'));
const release = read(path.join(repo, '.github/workflows/release.yml'));

describe('the image recipe', () => {
  it('has two stages, a non-root user, a data volume and a health check', () => {
    expect(dockerfile.match(/^FROM /gm)).toHaveLength(2);
    expect(dockerfile).toMatch(/^USER node$/m);
    expect(dockerfile).toMatch(/^VOLUME \["\/data"\]$/m);
    expect(dockerfile).toMatch(/^HEALTHCHECK /m);
    expect(dockerfile).toContain('/healthz');
    expect(dockerfile).toMatch(/^ARG NODE_IMAGE=node:22-slim@sha256:[0-9a-f]{64}$/m);
    expect(dockerfile).toContain('npm ci --omit=dev --ignore-scripts');
    expect(dockerfile).not.toContain('--no-package-lock');
    expect(dockerfile).toMatch(/MFEFLOW_REGISTRY_DB=\/data\//);
  });

  it('keeps the build context to tarballs', () => {
    expect(read(path.join(pkg, 'docker/.dockerignore')).trim().split('\n')).toEqual([
      '*',
      '!*.tgz',
      '!package.json',
      '!package-lock.json',
    ]);
  });

  it('has a compose file with the registry and MinIO that binds only to loopback', () => {
    expect(compose).toMatch(/^ {2}registry:$/m);
    expect(compose).toMatch(/^ {2}minio:$/m);
    for (const line of compose.split('\n').filter((l) => /^\s+- '\d/.test(l)))
      expect(line).toContain("'127.0.0.1:");
    expect(compose).toContain('registry-data:/data');
    expect(compose).toMatch(/stop_grace_period: 15s/);
  });
});

/** The text of every `run:` step, whole blocks included: a `run: |` runs to the next line that is indented no deeper. */
function runScripts(workflow: string): string[] {
  const lines = workflow.split('\n');
  const scripts: string[] = [];
  lines.forEach((line, i) => {
    const match = /^(\s*)(?:- )?run:\s*(.*)$/.exec(line);
    if (match === null) return;
    const indent = (match[1] ?? '').length;
    const body = [match[2] ?? ''];
    for (const next of lines.slice(i + 1)) {
      const depth = next.length - next.trimStart().length;
      if (next.trim() !== '' && depth <= indent) break;
      body.push(next);
    }
    scripts.push(body.join('\n'));
  });
  return scripts;
}

describe('the image job in the release workflow', () => {
  const jobs = release.split(/^ {2}(?=[a-z][a-z-]*:\n)/m).filter((j) => /^[a-z]/.test(j));
  const image = jobs.find((j) => j.startsWith('image:')) ?? '';

  it('exists, runs on ubuntu and waits for the npm publish', () => {
    expect(image).not.toBe('');
    expect(image).toMatch(/runs-on: ubuntu-latest/);
    expect(image).toMatch(/needs: \[plan, publish\]/);
  });

  it('is the only job that may write packages', () => {
    expect(image).toMatch(/packages: write/);
    expect(jobs.filter((j) => /^\s+packages: write/m.test(j))).toHaveLength(1);
    expect(release).toMatch(/^permissions: \{\}$/m);
  });

  it('pins every action by commit SHA, and keeps ${{ }} out of every run script', () => {
    for (const line of release.split('\n').filter((l) => l.includes('uses:')))
      expect(line, line).toMatch(/uses: [\w./-]+@[0-9a-f]{40}( #.*)?$/);
    for (const script of runScripts(release)) expect(script).not.toContain('${{');
  });

  it('waits for the package, locks it, and builds with provenance and an SBOM', () => {
    expect(image).toMatch(/for attempt in 1 2 3 4 5/);
    expect(image).toContain('npm view');
    expect(image).toContain('--package-lock-only');
    expect(image).toMatch(/provenance: true/);
    expect(image).toMatch(/sbom: true/);
  });

  it('builds only when the plan says @mfeflow/registry is being released', () => {
    expect(image).toContain('@mfeflow/registry');
    expect(image).toMatch(/if: /);
  });
});

/** Strips GIT_*, AWS_* and the registry token, so nothing a hook or a shell holds reaches a child. */
const cleanEnv = (): NodeJS.ProcessEnv =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      ([k]) => !k.startsWith('GIT_') && !k.startsWith('AWS_') && k !== 'MFEFLOW_REGISTRY_TOKEN',
    ),
  );

function run(cmd: string, args: string[], cwd: string): SpawnSyncReturns<string> {
  return spawnSync(cmd, args, { cwd, env: cleanEnv(), encoding: 'utf8' });
}

const dockerUp =
  (process.platform === 'linux' || process.env.MFEFLOW_DOCKER_TEST === '1') &&
  spawnSync('docker', ['info'], { stdio: 'ignore', env: cleanEnv() }).status === 0;

// Ubuntu only (and anywhere MFEFLOW_DOCKER_TEST=1 with a running daemon): builds the image from
// tarballs of this checkout, runs it, and stops it with SIGTERM.
describe.skipIf(!dockerUp)('the image, built and run with Docker', () => {
  const tag = `mfeflow-registry-test-${String(process.pid)}`;
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mfeflow-docker-'));
  const name = `${tag}-c`;

  afterAll(() => {
    run('docker', ['rm', '-f', name], work);
    run('docker', ['rmi', '-f', tag], work);
    fs.rmSync(work, { recursive: true, force: true });
  });

  it(
    'runs as an unprivileged user, answers /healthz and exits 0 on SIGTERM',
    { timeout: 600_000 },
    () => {
      for (const dir of [pkg, path.join(repo, 'packages/contracts')]) {
        const packed = run('pnpm', ['pack', '--pack-destination', work], dir);
        expect(packed.status, packed.stderr).toBe(0);
      }
      for (const file of ['Dockerfile', '.dockerignore'])
        fs.copyFileSync(path.join(pkg, 'docker', file), path.join(work, file));
      const tarballs = fs.readdirSync(work).filter((f) => f.endsWith('.tgz'));
      const built = run(
        'docker',
        [
          'build',
          '-t',
          tag,
          '--build-arg',
          `PACKAGE=${tarballs.map((t) => `/ctx/${t}`).join(' ')}`,
          '.',
        ],
        work,
      );
      expect(built.status, built.stderr).toBe(0);

      expect(
        run('docker', ['run', '--rm', '--entrypoint', 'id', tag, '-u'], work).stdout.trim(),
      ).not.toBe('0');

      const started = run(
        'docker',
        ['run', '-d', '--name', name, '-p', '127.0.0.1::8787', tag],
        work,
      );
      expect(started.status, started.stderr).toBe(0);
      const port = /:(\d+)\s*$/m.exec(run('docker', ['port', name, '8787/tcp'], work).stdout)?.[1];
      expect(port).toBeDefined();
      let ok = false;
      for (let i = 0; i < 40 && !ok; i += 1) {
        const probe = run(
          'node',
          [
            '-e',
            `fetch('http://127.0.0.1:${port ?? ''}/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))`,
          ],
          work,
        );
        ok = probe.status === 0;
        if (!ok) run('node', ['-e', 'setTimeout(()=>{},500)'], work);
      }
      expect(ok).toBe(true);

      expect(run('docker', ['stop', '-t', '10', name], work).status).toBe(0);
      expect(
        run('docker', ['inspect', '--format', '{{.State.ExitCode}}', name], work).stdout.trim(),
      ).toBe('0');
    },
  );
});

describe('the workflow reader', () => {
  it('reads a whole run block and stops where the indent returns', () => {
    const text = ['steps:', '  - run: |', '      a', '      b ${{ x }}', '  - run: c'].join('\n');
    expect(runScripts(text)).toEqual(['|\n      a\n      b ${{ x }}', 'c']);
  });
});
