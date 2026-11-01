import { ERROR_CATALOGUE, MfeflowError } from '@mfeflow/core';
import {
  GATE_CODES as REGISTRY_GATES,
  HostError,
  PreconditionFailedError,
} from '@mfeflow/registry/static';
import { describe, expect, it } from 'vitest';
import { exitCodeOfCode } from './exit';
import { validateResult } from './output';
import { baseUrlFor, envOf, GATE_CODES, hostFailure, positionals, type Session } from './publish';

describe('gate codes', () => {
  it('maps every gate of the registry to its own E5xx code with an exit code of 7', () => {
    expect(Object.keys(GATE_CODES).toSorted()).toEqual([...REGISTRY_GATES].toSorted());
    expect(new Set(Object.values(GATE_CODES)).size).toBe(REGISTRY_GATES.length);
    for (const code of Object.values(GATE_CODES)) {
      expect(code in ERROR_CATALOGUE).toBe(true);
      expect(exitCodeOfCode(`MFEFLOW_${code}`)).toBe(7);
    }
  });

  it('gives every E5xx error a fix that links the deploying guide', () => {
    const codes = Object.keys(ERROR_CATALOGUE).filter((c) => c.startsWith('E5'));
    expect(codes).toHaveLength(12);
    for (const code of codes)
      expect(ERROR_CATALOGUE[code as keyof typeof ERROR_CATALOGUE].fix).toContain(
        '/guide/deploying',
      );
  });
});

describe('hostFailure', () => {
  it('scrubs secrets and picks the code', () => {
    const leaky = new HostError('PUT failed: token SECRET123 was refused');
    const error = hostFailure(leaky, ['SECRET123']);
    expect(error).toBeInstanceOf(MfeflowError);
    expect(error).toMatchObject({ code: 'MFEFLOW_E506' });
    expect(error.message).not.toContain('SECRET123');
    expect(
      hostFailure(new HostError('x is already published with different content'), []),
    ).toMatchObject({ code: 'MFEFLOW_E511' });
    expect(hostFailure(new SyntaxError('Unexpected token'), [])).toMatchObject({
      code: 'MFEFLOW_E506',
    });
  });

  it('passes through errors the caller handles', () => {
    const race = new PreconditionFailedError('envs/prod/index.json');
    expect(hostFailure(race, [])).toBe(race);
    const plain = new Error('boom');
    expect(hostFailure(plain, [])).toBe(plain);
  });
});

describe('arguments', () => {
  it('checks env names and counts positionals', () => {
    expect(envOf({ env: 'prod' })).toBe('prod');
    expect(() => envOf({})).toThrow(/--env <env> is required/);
    expect(() => envOf({ env: 'Prod!' })).toThrow(/lowercase/);
    expect(positionals({ _: ['catalog'] }, 1, 'usage')).toEqual(['catalog']);
    expect(() => positionals({ _: ['a', 'b'] }, 1, 'mfeflow deploy <remote>')).toThrow(
      /unexpected "b"/,
    );
  });
});

describe('baseUrlFor', () => {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only baseUrl is read
  const session = (baseUrl?: string) => ({ baseUrl }) as Session;
  const remote = {
    name: 'cart',
    entry: 'https://cdn.test/assets/cart/1.0.0/mf-manifest.json',
    routes: ['/cart'],
  };

  it('prefers the setting, then reads it back from an entry in the index', () => {
    expect(baseUrlFor(session('https://set.test'), { remotes: [remote] })).toBe('https://set.test');
    expect(baseUrlFor(session(), { remotes: [remote] })).toBe('https://cdn.test/assets');
  });

  it('says what to set when it cannot know', () => {
    expect(() => baseUrlFor(session(), undefined)).toThrow(/registry\.baseUrl/);
    expect(() =>
      baseUrlFor(session(), { remotes: [{ ...remote, entry: 'https://x.test/m.json' }] }),
    ).toThrow(/--base-url/);
  });
});

describe('validateResult for the registry commands', () => {
  const deploy = {
    ok: true,
    command: 'deploy',
    dryRun: false,
    root: '/p',
    env: 'prod',
    fromEnv: null,
    host: 'file:/site',
    remote: 'catalog',
    version: '1.0.0',
    servedBefore: null,
    published: true,
    previous: null,
    rolledBackFrom: null,
    uploads: [{ key: 'a', bytes: 1, contentType: 'text/plain', cacheControl: 'x', guard: 'none' }],
    uploaded: ['a'],
    skipped: [],
    localEntry: null,
    warnings: [],
    findings: [],
  };
  const paths = (value: unknown) => validateResult(value).map((i) => i.path);

  it('accepts good documents and names what is wrong in bad ones', () => {
    expect(validateResult(deploy)).toEqual([]);
    expect(validateResult({ ...deploy, command: 'promote', fromEnv: 'staging' })).toEqual([]);
    expect(paths({ ...deploy, version: 1 })).toContain('version');
    expect(paths({ ...deploy, host: undefined })).toContain('host');
    expect(paths({ ...deploy, servedBefore: 1 })).toContain('servedBefore');
    expect(paths({ ...deploy, uploads: [{ key: 'a', bytes: '1', guard: 'x' }] })).toEqual(
      expect.arrayContaining(['uploads[0].bytes', 'uploads[0].guard']),
    );
    expect(paths({ ...deploy, dryRun: true })).toContain('uploaded');
    expect(paths({ ...deploy, index: [] })).toContain('index');
  });

  it('checks status documents', () => {
    const status = {
      ok: true,
      command: 'status',
      root: '/p',
      host: 'file:/site',
      envs: [
        {
          env: 'prod',
          published: true,
          generatedAt: null,
          remotes: [{ name: 'c', version: '1', history: [], drift: [], unreferenced: null }],
        },
      ],
      findings: [],
    };
    expect(validateResult(status)).toEqual([]);
    const bad = { ...status, envs: [{ env: 1, published: 'yes', generatedAt: 2, remotes: [{}] }] };
    expect(paths(bad)).toEqual(
      expect.arrayContaining([
        'envs[0].env',
        'envs[0].published',
        'envs[0].generatedAt',
        'envs[0].remotes[0].name',
      ]),
    );
  });
});
