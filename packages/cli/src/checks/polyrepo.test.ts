import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { main, type ReportResult } from '..';
import { removeDir, tempDir, testRuntime } from '../testing';

let parent = '';
let org = '';

beforeAll(async () => {
  parent = await tempDir();
  org = path.join(parent, 'acme');
  const code = await main(
    ['init', 'acme', '--topology', 'polyrepo', '--yes', '--no-install', '--cwd', parent],
    testRuntime(),
  );
  expect(code).toBe(0);
});
afterAll(async () => {
  await removeDir(parent);
});

async function report(command: string, repo: string): Promise<ReportResult> {
  const rt = testRuntime();
  const code = await main([command, '--json', '--cwd', path.join(org, repo)], rt);
  expect(code, `${command} in ${repo}: ${rt.io.out.join('')}`).toBe(0);
  return JSON.parse(rt.io.out.join('')) as ReportResult;
}

describe('mfeflow validate in a polyrepo', () => {
  it('passes in every repo with no errors and no warnings', async () => {
    for (const repo of ['platform', 'shell', 'catalog', 'cart']) {
      const result = await report('validate', repo);
      expect(result.findings, repo).toEqual([]);
    }
  });

  it('leaves the registry check to the shell repo', async () => {
    const remote = await report('validate', 'catalog');
    const registry = remote.checks.find((check) => check.id === 'config.registry');
    expect(registry?.status).toBe('skipped');
    const shell = await report('validate', 'shell');
    expect(shell.checks.find((check) => check.id === 'config.registry')?.status).toBe('pass');
  });
});

describe('mfeflow doctor in a polyrepo', () => {
  it('has no errors in any repo of a fresh polyrepo', async () => {
    for (const repo of ['platform', 'shell', 'catalog', 'cart']) {
      const result = await report('doctor', repo);
      expect(result.summary.errors, repo).toBe(0);
    }
  });
});
