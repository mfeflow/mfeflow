import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RUNTIME_CONFIG_FILE, runtimeConfigFiles } from './runtime-config';

const NAMES: ReadonlyArray<readonly [string, string | undefined | null]> = [
  ['runtime-config.json', undefined],
  ['runtime-config.dev.json', 'dev'],
  ['runtime-config.staging-eu.json', 'staging-eu'],
  ['runtime-config.Prod.json', null],
  ['runtime-config..json', null],
  ['runtime-config.dev.json.bak', null],
  ['my-runtime-config.dev.json', null],
  ['runtime-config.dev.yaml', null],
];

describe('RUNTIME_CONFIG_FILE', () => {
  it.each(NAMES)('%s -> %s', (name, env) => {
    const match = RUNTIME_CONFIG_FILE.exec(name);
    expect(match === null ? null : match[1]).toBe(env === undefined ? undefined : env);
  });

  it('is the pattern the generated check-runtime-config.ts carries', () => {
    const script = fs.readFileSync(
      path.resolve(import.meta.dirname, '../../../features/env-t3/files/check-runtime-config.ts'),
      'utf8',
    );
    const literal = /const ENV_FILE = (\/.+\/[a-z]*);/.exec(script)?.[1];
    expect(literal).toBe(String(RUNTIME_CONFIG_FILE));
  });
});

describe('runtimeConfigFiles', () => {
  let dir = '';
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('lists the matching names sorted, and nothing for a missing folder', async () => {
    for (const [name] of NAMES) fs.writeFileSync(path.join(dir, name), '{}');
    expect(await runtimeConfigFiles(dir)).toEqual([
      'runtime-config.dev.json',
      'runtime-config.json',
      'runtime-config.staging-eu.json',
    ]);
    expect(await runtimeConfigFiles(path.join(dir, 'nope'))).toEqual([]);
  });
});
