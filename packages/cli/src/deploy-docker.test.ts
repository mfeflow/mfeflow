import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse, parseAllDocuments } from 'yaml';
import { main } from '.';
import { REPO, removeDir, tempDir, testRuntime } from './testing';

const FILES = path.join(REPO, 'features/deploy-docker/files');
const source = (name: string): string => fs.readFileSync(path.join(FILES, name), 'utf8');

/** The environment without the variables a git hook sets, which would point child processes at the wrong repo. */
const cleanEnv = (extra: Record<string, string> = {}): Record<string, string> => ({
  ...Object.fromEntries(
    Object.entries(process.env).flatMap(([k, v]) =>
      v === undefined || k.startsWith('GIT_') ? [] : [[k, v]],
    ),
  ),
  ...extra,
});

let cwd = '';
let project = '';

beforeEach(async () => {
  cwd = await tempDir();
  project = path.join(cwd, 'app');
  const code = await main(
    ['init', 'app', '--yes', '--no-install', '--features=lint-oxlint,url-factory', '--cwd', cwd],
    testRuntime(),
  );
  expect(code).toBe(0);
});
afterEach(async () => {
  await removeDir(cwd);
});

const add = () => main(['add', 'deploy-docker', '--no-install', '--cwd', project], testRuntime());
const read = (file: string) => fsp.readFile(path.join(project, file), 'utf8');

/** The text without comment lines, so a rule mentioned in a comment is not mistaken for a directive. */
const code = (text: string): string =>
  text
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');

describe('deploy-docker files', () => {
  it('writes the Dockerfile, nginx configs, start script, compose, Kubernetes example, dockerignore and guide', async () => {
    expect(await add()).toBe(0);
    for (const file of [
      'docker/Dockerfile',
      'docker/nginx.shell.conf',
      'docker/nginx.remote.conf',
      'docker/40-mfe-config.sh',
      'docker/compose-registry.json',
      'compose.yaml',
      'k8s/mfe.yaml',
      '.dockerignore',
      'docs/docker.md',
    ]) {
      expect((await read(file)).length, file).toBeGreaterThan(0);
    }
  });

  it('is not part of init by default, and mfeflow.json records it', async () => {
    const before = JSON.parse(await read('mfeflow.json')) as { features: Record<string, unknown> };
    expect(before.features).not.toHaveProperty('deploy-docker');
    await add();
    const after = JSON.parse(await read('mfeflow.json')) as { features: Record<string, unknown> };
    expect(after.features).toHaveProperty('deploy-docker');
  });

  it('leaves validate and doctor passing', async () => {
    await add();
    for (const command of ['validate', 'doctor']) {
      const rt = testRuntime();
      expect(await main([command, '--cwd', project], rt), command).toBe(0);
    }
  });

  it('writes the same files twice from the same project', async () => {
    await add();
    const first = await read('compose.yaml');
    await removeDir(project);
    await main(
      ['init', 'app', '--yes', '--no-install', '--features=lint-oxlint,url-factory', '--cwd', cwd],
      testRuntime(),
    );
    await add();
    expect(await read('compose.yaml')).toBe(first);
  });
});

describe('the Dockerfile', () => {
  const dockerfile = source('Dockerfile');

  it('pins every base image by digest', () => {
    const images = [...dockerfile.matchAll(/^ARG (?:NODE|NGINX)_IMAGE=(\S+)$/gm)].map((m) => m[1]);
    expect(images).toHaveLength(2);
    for (const image of images) expect(image).toMatch(/^[\w./-]+:[\w.-]+@sha256:[0-9a-f]{64}$/);
    expect(images.join(' ')).toContain('nginx/nginx-unprivileged:');
    expect(images.join(' ')).not.toContain('nginxinc');
    for (const from of dockerfile.matchAll(/^FROM (\S+)/gm)) {
      expect(from[1], 'FROM uses a pinned ARG').toMatch(/^\$\{(NODE|NGINX)_IMAGE\}$/);
    }
  });

  it('builds on Node 24, which still has corepack', () => {
    expect(dockerfile).toMatch(/^ARG NODE_IMAGE=node:24\./m);
    expect(dockerfile).toContain('corepack enable');
  });

  it('installs from the lockfile only and never runs npm install', () => {
    const lines = code(dockerfile);
    expect(lines).toContain('pnpm install --frozen-lockfile');
    expect(lines).not.toMatch(/\bnpm (install|i|ci)\b|yarn install/);
    expect(lines.match(/pnpm install/g)).toHaveLength(1);
  });

  it('builds the app named by APP and runs nginx on 8080 as a non-root user', () => {
    expect(dockerfile).toMatch(/^ARG APP=shell$/m);
    expect(dockerfile).toContain('pnpm --filter "./apps/${APP}" build');
    expect(dockerfile).toContain('EXPOSE 8080');
    expect(code(dockerfile)).not.toMatch(/^USER root/m);
    expect(code(dockerfile)).not.toMatch(/^\s*USER 0\b/m);
  });

  it('has a health check that needs neither curl nor a shell script', () => {
    const check = dockerfile.slice(dockerfile.indexOf('HEALTHCHECK'));
    expect(check).toContain('wget');
    expect(check).toContain('/healthz');
    expect(check).not.toContain('curl');
  });

  it('refuses an APP that is not a plain app name', () => {
    expect(dockerfile).toContain('case "${APP}" in \'\'|*[!a-z0-9-]*)');
  });
});

describe('the nginx configs', () => {
  const shell = code(source('nginx.shell.conf'));
  const remote = code(source('nginx.remote.conf'));

  it('revalidate index.html, the runtime config, the registry index and the manifest', () => {
    for (const rule of [
      /location = \/config\/runtime-config\.json \{[^}]*Cache-Control "no-cache"/,
      /location = \/registry\/index\.json \{[^}]*Cache-Control "no-cache"/,
      /location \/ \{[^}]*try_files \$uri \/index\.html;[^}]*Cache-Control "no-cache"/,
      /location ~ \\\.\[A-Za-z0-9\]\+\$ \{[^}]*Cache-Control "no-cache"/,
    ]) {
      expect(shell).toMatch(rule);
    }
    expect(remote).toMatch(/location \/ \{[^}]*Cache-Control "no-cache"/);
  });

  it('caches hashed files and versioned paths for a year, and only on success', () => {
    const immutable = 'Cache-Control "public, max-age=31536000, immutable";';
    expect(shell).toMatch(new RegExp(`location \\^~ /static/ \\{[^}]*${immutable}`));
    expect(remote).toMatch(new RegExp(`location \\^~ /static/ \\{[^}]*${immutable}`));
    expect(remote).toMatch(
      new RegExp(`location \\^~ /mfe/__NAME__/__VERSION__/ \\{[^}]*${immutable}`),
    );
    expect(shell + remote).not.toMatch(/immutable" always/);
  });

  it('falls back to index.html in the shell only', () => {
    expect(shell).toContain('try_files $uri /index.html;');
    expect(remote).not.toContain('index.html');
  });

  it('sends CORS headers wherever a remote sets Cache-Control, and none from the shell', () => {
    const blocks = [...remote.matchAll(/location [^{]+\{([^}]*)\}/g)].map((m) => m[1] ?? '');
    const cached = blocks.filter((b) => b.includes('Cache-Control'));
    expect(cached).toHaveLength(3);
    for (const block of cached) {
      expect(block).toContain('Access-Control-Allow-Origin $mfe_cors_origin always;');
      expect(block).toContain('Vary Origin always;');
    }
    expect(remote).not.toMatch(/Access-Control-Allow-Origin \*/);
    expect(shell).not.toContain('Access-Control-Allow-Origin');
  });

  it('serves .mjs as JavaScript without replacing the stock types', () => {
    for (const conf of [shell, remote]) {
      expect(conf).toMatch(/^types \{\s*text\/javascript mjs;\s*\}$/m);
      expect(conf).not.toContain('mime.types');
    }
  });

  it('compresses with gzip and claims no brotli directive', () => {
    for (const conf of [shell, remote]) {
      expect(conf).toContain('gzip on;');
      expect(conf).not.toMatch(/^\s*brotli/m);
    }
    expect(source('nginx.shell.conf')).toContain('no brotli module');
  });

  it('answers /healthz and listens on 8080', () => {
    for (const conf of [shell, remote]) {
      expect(conf).toContain('listen 8080;');
      expect(conf).toMatch(/location = \/healthz \{[^}]*return 200/);
    }
  });

  it('keeps the placeholders the Dockerfile fills in', () => {
    expect(remote).toContain('__NAME__');
    expect(remote).toContain('__VERSION__');
    expect(source('Dockerfile')).toContain('s/__NAME__/${APP}/g');
    expect(source('Dockerfile')).toContain('s/__VERSION__/${version}/g');
  });
});

describe('the start script', () => {
  const script = source('40-mfe-config.sh');

  it('is plain POSIX sh with no bash features', () => {
    expect(script.startsWith('#!/bin/sh\n')).toBe(true);
    const lines = code(script);
    expect(lines).not.toMatch(
      /\[\[|\blocal\b|\bfunction\b|\$\(\(|<\(|\bsource\b|\$\{[^}]*(\/\/|,,|\^\^)/,
    );
    expect(lines).not.toMatch(/\barray\b|\bdeclare\b|==|\becho -e\b/);
    expect(lines).toContain('set -eu');
  });

  describe.runIf(process.platform === 'linux')('run with sh', () => {
    const dirs: string[] = [];
    afterAll(() => {
      for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
    });

    function setup(configs: string[]) {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mfe-start-'));
      dirs.push(root);
      const configDir = path.join(root, 'configs');
      fs.mkdirSync(configDir);
      for (const name of configs)
        fs.writeFileSync(path.join(configDir, name), `{"from":"${name}"}`);
      fs.writeFileSync(path.join(root, 'start.sh'), script);
      const run = (env: Record<string, string>) =>
        spawnSync('sh', ['start.sh'], {
          cwd: root,
          encoding: 'utf8',
          env: cleanEnv({
            MFE_RUNTIME_DIR: path.join(root, 'runtime'),
            MFE_CONFIGS_DIR: configDir,
            ...env,
          }),
        });
      return { root, run, runtime: path.join(root, 'runtime') };
    }

    it('parses with sh -n', () => {
      const { root } = setup([]);
      const result = spawnSync('sh', ['-n', 'start.sh'], { cwd: root, encoding: 'utf8' });
      expect(result.status, result.stderr).toBe(0);
    });

    it('copies the file MFE_ENV names to runtime-config.json', () => {
      const { run, runtime } = setup(['runtime-config.staging.json', 'runtime-config.prod.json']);
      const result = run({ MFE_ENV: 'staging' });
      expect(result.status, result.stderr).toBe(0);
      expect(fs.readFileSync(path.join(runtime, 'runtime-config.json'), 'utf8')).toBe(
        '{"from":"runtime-config.staging.json"}',
      );
    });

    it('stops with a clear message when the file for MFE_ENV is missing', () => {
      const { run, runtime } = setup(['runtime-config.prod.json']);
      const result = run({ MFE_ENV: 'qa' });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('no runtime config for MFE_ENV=qa');
      expect(result.stderr).toContain('runtime-config.prod.json');
      expect(fs.existsSync(path.join(runtime, 'runtime-config.json'))).toBe(false);
    });

    it('stops when nothing says which config to use', () => {
      const { run } = setup(['runtime-config.prod.json']);
      const result = run({});
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('set MFE_ENV');
    });

    it('uses the only runtime-config.json when MFE_ENV is not set', () => {
      const { run, runtime } = setup(['runtime-config.json']);
      expect(run({}).status).toBe(0);
      expect(fs.readFileSync(path.join(runtime, 'runtime-config.json'), 'utf8')).toContain(
        'runtime-config.json',
      );
    });

    it('leaves a runtime-config.json that is already there, even with MFE_ENV set to something unknown', () => {
      const { run, runtime } = setup(['runtime-config.prod.json']);
      fs.mkdirSync(runtime);
      fs.writeFileSync(path.join(runtime, 'runtime-config.json'), 'mounted');
      const result = run({ MFE_ENV: 'whatever' });
      expect(result.status, result.stderr).toBe(0);
      expect(fs.readFileSync(path.join(runtime, 'runtime-config.json'), 'utf8')).toBe('mounted');
    });

    it('writes a CORS map on a remote and does nothing without SHELL_ORIGINS', () => {
      const { run, runtime } = setup([]);
      expect(run({}).status).toBe(0);
      expect(fs.existsSync(runtime)).toBe(false);
      const result = run({ SHELL_ORIGINS: 'https://shop.example.com, http://localhost:4300' });
      expect(result.status, result.stderr).toBe(0);
      expect(fs.readFileSync(path.join(runtime, 'cors-origins.map'), 'utf8')).toBe(
        '"https://shop.example.com" "https://shop.example.com";\n"http://localhost:4300" "http://localhost:4300";\n',
      );
    });

    it.each([
      '*',
      'shop.example.com',
      'https://shop.example.com/app',
      'https://a b',
      'https://a";x',
    ])('refuses SHELL_ORIGINS entry %s', (origin) => {
      const { run, runtime } = setup([]);
      const result = run({ SHELL_ORIGINS: origin });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('SHELL_ORIGINS');
      expect(fs.readFileSync(path.join(runtime, 'cors-origins.map'), 'utf8')).not.toContain('x');
    });
  });
});

describe('.dockerignore', () => {
  it('keeps dependencies, build output, git and env files out of the context', () => {
    const lines = source('dockerignore').split('\n');
    for (const entry of ['node_modules', '**/node_modules', '**/dist', '.git', '.env']) {
      expect(lines).toContain(entry);
    }
    expect(lines).toContain('!.env.example');
    expect(lines).not.toContain('docker');
    expect(lines).not.toContain('pnpm-lock.yaml');
  });
});

interface Container {
  name: string;
  image?: string;
  securityContext?: Record<string, unknown>;
  readinessProbe?: { httpGet?: { path?: string } };
  livenessProbe?: { httpGet?: { path?: string } };
  resources?: { requests?: Record<string, string> };
  volumeMounts?: { name: string; mountPath: string; subPath?: string }[];
}
interface Doc {
  kind: string;
  spec?: {
    template?: {
      spec?: {
        securityContext?: Record<string, unknown>;
        containers?: Container[];
        volumes?: { name: string; emptyDir?: unknown; configMap?: unknown }[];
      };
    };
  };
}

describe('the Kubernetes example', () => {
  const text = source('k8s.yaml');
  const docs = parseAllDocuments(text);
  const items = docs.map((d) => d.toJS() as Doc);
  const deployment = items.find((d) => d.kind === 'Deployment');
  const pod = deployment?.spec?.template?.spec;
  const container = pod?.containers?.[0];

  it('parses as YAML with a ConfigMap, a Deployment and a Service', () => {
    for (const doc of docs) expect(doc.errors).toEqual([]);
    expect(items.map((d) => d.kind)).toEqual(['ConfigMap', 'ConfigMap', 'Deployment', 'Service']);
  });

  it('mounts the config as directories and never with subPath', () => {
    expect(code(text)).not.toMatch(/subPath/);
    expect(text).toMatch(/subPath never receives later changes/);
    const mounts = container?.volumeMounts ?? [];
    expect(mounts.map((m) => m.mountPath).toSorted()).toEqual([
      '/tmp',
      '/tmp/mfe-registry',
      '/tmp/mfe-runtime',
    ]);
    for (const mount of mounts) expect(mount.subPath).toBeUndefined();
  });

  it('runs non-root on a read-only root filesystem with an emptyDir for /tmp', () => {
    expect(pod?.securityContext).toMatchObject({ runAsNonRoot: true, runAsUser: 101 });
    expect(container?.securityContext).toMatchObject({
      readOnlyRootFilesystem: true,
      allowPrivilegeEscalation: false,
    });
    const tmp = container?.volumeMounts?.find((m) => m.mountPath === '/tmp');
    expect(pod?.volumes?.find((v) => v.name === tmp?.name)?.emptyDir).toBeDefined();
  });

  it('probes the health path and asks for resources', () => {
    expect(container?.readinessProbe?.httpGet?.path).toBe('/healthz');
    expect(container?.livenessProbe?.httpGet?.path).toBe('/healthz');
    expect(container?.resources?.requests).toMatchObject({ cpu: expect.any(String) as string });
  });
});

describe('the compose file', () => {
  it('runs the shell and every remote on the ports in mfeflow.json, with MFE_ENV', async () => {
    await add();
    const compose = parse(await read('compose.yaml'), { merge: true }) as {
      services: Record<
        string,
        {
          ports: string[];
          environment: Record<string, string>;
          read_only: boolean;
          build: { args: { APP: string } };
        }
      >;
    };
    expect(Object.keys(compose.services)).toEqual(['shell', 'catalog', 'cart']);
    const { shell, catalog, cart } = compose.services;
    expect(shell?.ports).toEqual(['4300:8080']);
    expect(catalog?.ports).toEqual(['4311:8080']);
    expect(cart?.ports).toEqual(['4312:8080']);
    expect(shell?.environment.MFE_ENV).toBe('${MFE_ENV:-dev}');
    expect(catalog?.environment.SHELL_ORIGINS).toBe('http://localhost:4300');
    expect(cart?.build.args.APP).toBe('cart');
    for (const service of Object.values(compose.services)) expect(service.read_only).toBe(true);
    const registry = JSON.parse(await read('docker/compose-registry.json')) as {
      remotes: { name: string; entry: string }[];
    };
    expect(registry.remotes.map((r) => r.entry)).toEqual([
      'http://localhost:4311/mf-manifest.json',
      'http://localhost:4312/mf-manifest.json',
    ]);
  });
});

describe('the guide', () => {
  it('does not claim brotli or a flow mfeflow forces', () => {
    const guide = source('docker.md');
    expect(guide).toContain('no brotli module');
    expect(guide).toContain('mfeflow does not call it');
  });
});
