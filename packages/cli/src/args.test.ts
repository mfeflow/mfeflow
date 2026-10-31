import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertKnownFlags, GLOBAL_ARGS, readGlobals, repeated, splitList } from './args';
import { thrown } from './testing';

describe('readGlobals', () => {
  const cwd = path.resolve('/work/project');

  it('defaults: prompts allowed, install on, nothing else set', () => {
    expect(readGlobals({}, {}, cwd)).toEqual({
      yes: false,
      preset: undefined,
      json: false,
      dryRun: false,
      cwd,
      install: true,
      verbose: false,
      local: undefined,
    });
  });

  it('reads every global flag, with --no-install and a relative --cwd', () => {
    const globals = readGlobals(
      {
        yes: true,
        preset: 'p.json',
        json: true,
        'dry-run': true,
        cwd: '../other',
        install: false,
        verbose: true,
        local: '/mf',
      },
      {},
      cwd,
    );
    expect(globals).toMatchObject({
      yes: true,
      preset: 'p.json',
      json: true,
      dryRun: true,
      install: false,
      verbose: true,
      local: '/mf',
    });
    expect(globals.cwd).toBe(path.resolve(cwd, '../other'));
  });

  it('takes --local from MFEFLOW_LOCAL, and the flag wins', () => {
    expect(readGlobals({}, { MFEFLOW_LOCAL: '/env' }, cwd).local).toBe('/env');
    expect(readGlobals({ local: '/flag' }, { MFEFLOW_LOCAL: '/env' }, cwd).local).toBe('/flag');
    expect(readGlobals({}, { MFEFLOW_LOCAL: '' }, cwd).local).toBeUndefined();
  });
});

describe('assertKnownFlags', () => {
  it('accepts declared flags, their aliases, --no-<boolean> and --flag=value', () => {
    expect(() => {
      assertKnownFlags(
        ['x', '--yes', '-y', '--no-install', '--cwd=/a', '--preset', 'f.json'],
        GLOBAL_ARGS,
      );
    }).not.toThrow();
  });

  it('stops looking after --', () => {
    expect(() => {
      assertKnownFlags(['--yes', '--', '--whatever'], GLOBAL_ARGS);
    }).not.toThrow();
  });

  it('rejects an unknown flag with E107 and names it', () => {
    const error = thrown(() => {
      assertKnownFlags(['--bogus'], GLOBAL_ARGS);
    });
    expect(error.code).toBe('MFEFLOW_E107');
    expect(error.message).toContain('--bogus');
    expect(
      thrown(() => {
        assertKnownFlags(['-q'], GLOBAL_ARGS);
      }).message,
    ).toContain('-q');
  });

  it('does not accept --no- for a flag that takes a value', () => {
    expect(
      thrown(() => {
        assertKnownFlags(['--no-cwd'], GLOBAL_ARGS);
      }).code,
    ).toBe('MFEFLOW_E107');
  });
});

describe('repeated and splitList', () => {
  it('collects every value of a repeated flag, both spellings', () => {
    expect(
      repeated(['--option', 'a.b=1', 'x', '--option=c.d=2', '--other', 'v'], 'option'),
    ).toEqual(['a.b=1', 'c.d=2']);
    expect(repeated(['--', '--option', 'a'], 'option')).toEqual([]);
    expect(repeated(['--option'], 'option')).toEqual([]);
  });

  it('splits comma lists, trimming and dropping empties', () => {
    expect(splitList('a, b,,c ')).toEqual(['a', 'b', 'c']);
    expect(splitList(['x', ' ', 'y'])).toEqual(['x', 'y']);
    expect(splitList(undefined)).toBeUndefined();
  });
});
