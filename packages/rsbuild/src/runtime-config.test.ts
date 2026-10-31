import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createShellConfig } from './index';
import {
  RUNTIME_CONFIG_URL,
  runtimeConfigEnv,
  runtimeConfigEnvs,
  runtimeConfigHandler,
  runtimeConfigSetup,
} from './runtime-config';

let cwd = '';
beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-'));
});
afterEach(() => {
  fs.rmSync(cwd, { recursive: true, force: true });
});

function config(files: Record<string, string>): void {
  const dir = path.join(cwd, 'public', 'config');
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
}

interface Answer {
  status: number;
  headers: Record<string, string>;
  body: string | undefined;
  nexted: boolean;
}

function ask(
  handler: ReturnType<typeof runtimeConfigHandler>,
  url: string,
  method = 'GET',
): Answer {
  const answer: Answer = { status: 0, headers: {}, body: undefined, nexted: false };
  const res = {
    statusCode: 0,
    setHeader: (name: string, value: string) => {
      answer.headers[name] = value;
    },
    end: (body?: string) => {
      answer.status = res.statusCode;
      answer.body = body;
    },
  };
  handler({ url, method } as IncomingMessage, res as unknown as ServerResponse, () => {
    answer.nexted = true;
  });
  return answer;
}

describe('runtimeConfigEnv', () => {
  it('is MFE_ENV, and dev when it is unset or empty', () => {
    expect(runtimeConfigEnv({})).toBe('dev');
    expect(runtimeConfigEnv({ MFE_ENV: '' })).toBe('dev');
    expect(runtimeConfigEnv({ MFE_ENV: 'staging-eu' })).toBe('staging-eu');
  });

  it('refuses a name that could leave the config folder', () => {
    for (const MFE_ENV of ['../prod', 'Prod', 'a/b', 'a b']) {
      expect(() => runtimeConfigEnv({ MFE_ENV }), MFE_ENV).toThrow(
        /MFE_ENV=.* is not an environment/,
      );
    }
  });
});

describe('runtimeConfigEnvs', () => {
  it('lists the envs that have a file, ignoring the unsuffixed file and other names', () => {
    expect(runtimeConfigEnvs(cwd)).toEqual([]);
    config({
      'runtime-config.prod.json': '{}',
      'runtime-config.dev.json': '{}',
      'runtime-config.json': '{}',
      'runtime-config.dev.json.bak': '{}',
      'other.json': '{}',
    });
    expect(runtimeConfigEnvs(cwd)).toEqual(['dev', 'prod']);
  });
});

describe('runtimeConfigHandler', () => {
  it('answers the config URL with the chosen env file, read fresh each time', () => {
    config({
      'runtime-config.dev.json': '{"environment":"dev"}',
      'runtime-config.prod.json': '{"environment":"prod"}',
    });
    const dev = runtimeConfigHandler(cwd, 'dev');
    const first = ask(dev, `${RUNTIME_CONFIG_URL}?v=1`);
    expect(first).toMatchObject({ status: 200, body: '{"environment":"dev"}', nexted: false });
    expect(first.headers).toMatchObject({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    expect(ask(runtimeConfigHandler(cwd, 'prod'), RUNTIME_CONFIG_URL).body).toBe(
      '{"environment":"prod"}',
    );
    config({ 'runtime-config.dev.json': '{"environment":"dev","edited":true}' });
    expect(ask(dev, RUNTIME_CONFIG_URL).body).toContain('edited');
  });

  it('answers HEAD without a body and passes every other request on', () => {
    config({ 'runtime-config.dev.json': '{}' });
    const handler = runtimeConfigHandler(cwd, 'dev');
    expect(ask(handler, RUNTIME_CONFIG_URL, 'HEAD')).toMatchObject({
      status: 200,
      body: undefined,
    });
    expect(ask(handler, RUNTIME_CONFIG_URL, 'POST').nexted).toBe(true);
    expect(ask(handler, '/config/runtime-config.dev.json').nexted).toBe(true);
    expect(ask(handler, '/').nexted).toBe(true);
  });

  it('is a 404 that names the envs that exist when the chosen env has no file', () => {
    config({ 'runtime-config.dev.json': '{}', 'runtime-config.prod.json': '{}' });
    const answer = ask(runtimeConfigHandler(cwd, 'staging'), RUNTIME_CONFIG_URL);
    expect(answer.status).toBe(404);
    expect(answer.body).toBe(
      'MFE_ENV=staging has no public/config/runtime-config.staging.json (found: dev, prod)',
    );
  });
});

describe('runtimeConfigSetup', () => {
  it('is nothing for a shell without env files, so a plain shell is untouched', () => {
    expect(runtimeConfigSetup(cwd, {})).toBeUndefined();
    config({ 'runtime-config.json': '{}' });
    expect(runtimeConfigSetup(cwd, {})).toBeUndefined();
  });

  it('registers the handler on the dev and preview server middlewares', async () => {
    config({ 'runtime-config.dev.json': '{}' });
    const use = vi.fn();
    const setup = runtimeConfigSetup(cwd, {});
    await setup?.({ action: 'dev', environments: {}, server: { middlewares: { use } } } as never);
    expect(use).toHaveBeenCalledOnce();
  });

  it('fails at config load for an MFE_ENV that is not a name', () => {
    config({ 'runtime-config.dev.json': '{}' });
    expect(() => runtimeConfigSetup(cwd, { MFE_ENV: '../x' })).toThrow(/MFE_ENV/);
  });
});

describe('createShellConfig', () => {
  it('sets up the runtime config only when the shell has env files', () => {
    expect(createShellConfig({ name: 'shell', cwd, env: {} }).server?.setup).toBeUndefined();
    config({ 'runtime-config.dev.json': '{}' });
    expect(createShellConfig({ name: 'shell', cwd, env: {} }).server?.setup).toBeTypeOf('function');
  });
});
