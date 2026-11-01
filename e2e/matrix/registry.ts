// The third-party registry flow on a real project: builds e2e/registry-fixture with `mfeflow registry build`,
// serves it from 127.0.0.1, generates a project, runs `mfeflow registry add @test http://127.0.0.1:<port>/{name}.json`
// and `mfeflow add @test/hello`, then installs, builds, typechecks, lints and tests the result and runs the doctor on it.
// Also checks that plain http to anything but a loopback host is refused.
//   node e2e/matrix/registry.ts        (MATRIX_DIR picks where the project is generated; default: the OS temp folder)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const repo = path.resolve(import.meta.dirname, '../..');
const cli = path.join(repo, 'packages/cli/bin/mfeflow.js');
const fixture = path.join(repo, 'e2e/registry-fixture');

function run(command: string, args: string[], cwd: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      shell: process.platform === 'win32' && command === 'pnpm',
    });
    child.on('error', () => {
      resolve(1);
    });
    child.on('close', (code) => {
      resolve(code ?? 1);
    });
  });
}

const mfeflow = (args: string[], cwd: string) => run(process.execPath, [cli, ...args], cwd);

/** Output of a mfeflow run. Async on purpose: the registry server lives in this process, which a sync spawn would block. */
function capture(args: string[], cwd: string): Promise<{ status: number; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd });
    let out = '';
    child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (out += chunk.toString()));
    child.on('close', (code) => {
      resolve({ status: code ?? 1, out });
    });
  });
}

function serve(root: string): Promise<http.Server> {
  const server = http.createServer((request, response) => {
    const file = path.join(root, ...new URL(request.url ?? '/', 'http://x').pathname.split('/'));
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      response.writeHead(404).end('not found');
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' }).end(fs.readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function fail(step: string, why = ''): never {
  throw new Error(`registry flow failed at ${step}${why ? `: ${why}` : ''}`);
}

const base = fs.realpathSync(process.env.MATRIX_DIR ?? os.tmpdir());
const work = fs.mkdtempSync(path.join(base, 'mfeflow-registry-'));
const site = path.join(work, 'site');
const project = path.join(work, 'app');
let server: http.Server | undefined;

try {
  console.log('\n--- registry build');
  if ((await mfeflow(['registry', 'build', fixture, '--out', site], work)) !== 0)
    fail('registry build');
  server = await serve(site);
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  const template = `http://127.0.0.1:${String(port)}/{name}.json`;

  console.log('\n--- init');
  const init = ['init', 'app', '--yes', '--no-install', '--local', repo, '--cwd', work];
  if ((await mfeflow(init, work)) !== 0) fail('init');

  console.log('\n--- registry add refuses plain http to a non-loopback host');
  const plain = await capture(
    ['registry', 'add', '@bad', 'http://registry.example.com/{name}.json'],
    project,
  );
  if (plain.status === 0 || !plain.out.includes('must be https')) fail('plain http', plain.out);

  console.log('\n--- registry add @test');
  if ((await mfeflow(['registry', 'add', '@test', template], project)) !== 0) fail('registry add');
  const found = await capture(['features', 'greeting', '--json'], project);
  if (!found.out.includes('"name": "@test/hello"') || !found.out.includes('"source": "@test"')) {
    fail('features', found.out);
  }

  console.log('\n--- add @test/hello');
  if ((await mfeflow(['add', '@test/hello', '--yes', '--no-install'], project)) !== 0) fail('add');
  const hello = path.join(project, 'apps/shell/src/hello.ts');
  if (!fs.readFileSync(hello, 'utf8').includes("from 'clsx'")) fail('add', 'src/hello.ts is wrong');

  for (const [name, args] of [
    ['install', ['install']],
    ['build', ['build']],
    ['typecheck', ['typecheck']],
    ['lint', ['lint']],
    ['format:check', ['format:check']],
    ['test', ['test']],
  ] as const) {
    console.log(`\n--- ${name}`);
    // oxlint-disable-next-line no-await-in-loop -- the steps depend on each other
    if ((await run('pnpm', [...args], project)) !== 0) fail(name);
  }
  for (const name of ['doctor', 'validate', 'check-compat']) {
    console.log(`\n--- ${name}`);
    // oxlint-disable-next-line no-await-in-loop -- as above
    if ((await mfeflow([name], project)) !== 0) fail(name);
  }
  console.log('\nregistry flow passed');
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  server?.close();
  fs.rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
