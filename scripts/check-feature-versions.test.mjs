import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { changedFolders, cleanEnv, main, unbumped } from './check-feature-versions.mjs';

let repo;
const run = (...args) => {
  const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8', env: cleanEnv() });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout;
};
const write = (file, content) => {
  const full = path.join(repo, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
};
const manifest = (version) => `${JSON.stringify({ name: 'x', version })}\n`;
const commit = (message) => {
  run('add', '-A');
  run('commit', '-m', message);
};

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'mfeflow-bump-'));
  run('init', '-q', '-b', 'main');
  run('config', 'user.email', 'test@example.com');
  run('config', 'user.name', 'Test');
  run('config', 'commit.gpgsign', 'false');
  write('features/forms/feature.json', manifest('0.1.0'));
  write('features/forms/files/a.ts', 'one\n');
  write('features/http/feature.json', manifest('0.1.0'));
  write('templates/monorepo/feature.json', manifest('0.1.0'));
  write('packages/other/index.ts', 'x\n');
  commit('base');
  run('switch', '-q', '-c', 'topic');
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

describe('check-feature-versions', () => {
  it('drops the GIT_* variables a hook sets', () => {
    expect(cleanEnv({ GIT_DIR: '/x', GIT_INDEX_FILE: 'y', PATH: '/bin' })).toEqual({
      PATH: '/bin',
    });
  });

  it('passes when nothing under features or templates changed', () => {
    write('packages/other/index.ts', 'y\n');
    commit('other');
    expect(unbumped(repo, 'main')).toEqual([]);
  });

  it('fails when a feature file changed without a version bump', () => {
    write('features/forms/files/a.ts', 'two\n');
    commit('edit');
    expect(unbumped(repo, 'main')).toEqual([
      'features/forms changed but features/forms/feature.json is still at version 0.1.0',
    ]);
  });

  it('passes when the same change bumps the version', () => {
    write('features/forms/files/a.ts', 'two\n');
    write('features/forms/feature.json', manifest('0.2.0'));
    commit('edit and bump');
    expect(unbumped(repo, 'main')).toEqual([]);
  });

  it('names every folder that is behind, templates included', () => {
    write('features/forms/files/a.ts', 'two\n');
    write('templates/monorepo/files/b.ts', 'new\n');
    write('features/http/feature.json', manifest('0.2.0'));
    write('features/http/files/c.ts', 'c\n');
    commit('edits');
    expect(unbumped(repo, 'main').map((line) => line.split(' ')[0])).toEqual([
      'features/forms',
      'templates/monorepo',
    ]);
  });

  it('accepts a new feature and a deleted one without a bump', () => {
    write('features/fresh/feature.json', manifest('0.1.0'));
    fs.rmSync(path.join(repo, 'features/http'), { recursive: true });
    commit('add and remove');
    expect(changedFolders(repo, 'main', 'HEAD')).toEqual(['features/fresh', 'features/http']);
    expect(unbumped(repo, 'main')).toEqual([]);
  });

  it('compares against the merge-base, not the tip of the base branch', () => {
    run('switch', '-q', 'main');
    write('features/forms/files/a.ts', 'moved on\n');
    write('features/forms/feature.json', manifest('0.2.0'));
    commit('main moves');
    run('switch', '-q', 'topic');
    write('features/http/files/d.ts', 'd\n');
    commit('topic edit');
    expect(unbumped(repo, 'main')).toEqual([
      'features/http changed but features/http/feature.json is still at version 0.1.0',
    ]);
  });

  it('exits 1 with the problem, 0 when clean, and 2 without a base', () => {
    expect(main([])).toBe(2);
    expect(main(['main', repo])).toBe(0);
    write('features/forms/files/a.ts', 'two\n');
    commit('edit');
    expect(main(['main', repo])).toBe(1);
  });
});
