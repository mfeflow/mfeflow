import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { main } from '.';
import { readPackageJson } from './version';

// The runtime is the CLI's own; the test only needs a prompter-free, install-free one.
const runtimeIn = (out: string[], err: string[]) => ({
  io: {
    stdout: (t: string) => out.push(t),
    stderr: (t: string) => err.push(t),
    cwd: process.cwd(),
    env: {},
    interactive: false,
  },
  prompter: {
    text: () => Promise.reject(new Error('no prompts')),
    multiselect: () => Promise.reject(new Error('no prompts')),
    select: () => Promise.reject(new Error('no prompts')),
    confirm: () => Promise.reject(new Error('no prompts')),
  },
  system: { install: () => Promise.resolve(), gitInit: () => Promise.resolve(false) },
  fetch: () => Promise.reject(new Error('no network')),
  roots: {
    features: path.resolve(import.meta.dirname, '../../../features'),
    templates: path.resolve(import.meta.dirname, '../../../templates'),
  },
});

describe('create-mfeflow', () => {
  it('prints its own version', async () => {
    const write = process.stdout.write.bind(process.stdout);
    const seen: string[] = [];
    process.stdout.write = (chunk: string | Uint8Array) => {
      seen.push(String(chunk));
      return true;
    };
    try {
      expect(await main(['--version'])).toBe(0);
    } finally {
      process.stdout.write = write;
    }
    expect(seen.join('')).toBe(`create-mfeflow ${readPackageJson().version}\n`);
  });

  it('runs `mfeflow init` with the arguments it was given', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'create-mfeflow-'));
    try {
      const out: string[] = [];
      const err: string[] = [];
      const code = await main(
        ['my-app', '--yes', '--no-install', '--cwd', cwd],
        runtimeIn(out, err),
      );
      expect(err).toEqual([]);
      expect(code).toBe(0);
      expect(await fs.readFile(path.join(cwd, 'my-app', 'mfeflow.json'), 'utf8')).toContain(
        '"scope": "@my-app"',
      );
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });

  it('shows the help of init for --help', async () => {
    const out: string[] = [];
    expect(await main(['--help'], runtimeIn(out, []))).toBe(0);
    expect(out.join('\n')).toContain('mfeflow init - create a new project');
  });
});
