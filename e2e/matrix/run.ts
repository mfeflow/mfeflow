// Generates each combination of first-party features with `mfeflow init --local`, installs it, builds it,
// typechecks and lints it, and runs doctor, validate and check-compat on it.
//   node e2e/matrix/run.ts --list     the combination ids as JSON (for the CI matrix)
//   node e2e/matrix/run.ts [id...]    run these (default: all)
// MATRIX_DIR picks where projects are generated (default: the OS temp folder); node_modules goes after each.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { combinations, find, presetOf, stepsFor, type Combo } from './combos.ts';

const repo = path.resolve(import.meta.dirname, '../..');
const cli = path.join(repo, 'packages/cli/bin/mfeflow.js');

function selection(): Combo[] {
  const ids = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  return ids.length > 0 ? find(ids) : combinations();
}

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

async function check(combo: Combo, work: string): Promise<string | undefined> {
  const project = path.join(work, 'app');
  fs.writeFileSync(path.join(work, 'preset.json'), JSON.stringify(presetOf(combo)));
  const generate = await run(
    process.execPath,
    [
      cli,
      'init',
      'app',
      '--yes',
      '--no-install',
      '--local',
      repo,
      '--preset',
      'preset.json',
      '--cwd',
      work,
    ],
    work,
  );
  if (generate !== 0) return 'generate';
  for (const step of stepsFor(combo)) {
    console.log(`\n--- ${combo.id}: ${step.name}`);
    const code =
      step.command === 'mfeflow'
        ? // oxlint-disable-next-line no-await-in-loop -- the steps depend on each other
          await run(process.execPath, [cli, step.name], project)
        : // oxlint-disable-next-line no-await-in-loop -- as above
          await run('pnpm', step.args, project);
    if (code !== 0) return step.name;
  }
  return undefined;
}

if (process.argv.includes('--list')) {
  console.log(JSON.stringify(combinations().map((c) => c.id)));
} else {
  const base = process.env.MATRIX_DIR ?? os.tmpdir();
  fs.mkdirSync(base, { recursive: true });
  const failures: string[] = [];
  for (const combo of selection()) {
    const work = fs.mkdtempSync(path.join(base, `mfeflow-matrix-${combo.id}-`));
    const started = Date.now();
    console.log(`\n=== ${combo.id}`);
    // oxlint-disable-next-line no-await-in-loop -- one project on disk at a time keeps the disk small
    const failed = await check(combo, work);
    fs.rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    const seconds = Math.round((Date.now() - started) / 1000);
    if (failed) failures.push(`${combo.id} (${failed})`);
    console.log(
      `=== ${combo.id}: ${failed ? `FAILED at ${failed}` : 'ok'} in ${String(seconds)} s`,
    );
  }
  if (failures.length > 0) {
    console.error(`\nfailed: ${failures.join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log('\nmatrix passed');
  }
}
