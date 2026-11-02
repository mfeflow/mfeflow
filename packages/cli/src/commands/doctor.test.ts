import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_SINGLETONS } from '@mfeflow/rsbuild';
import { main, validateResult, type ReportResult } from '..';
import { SINGLETON_SPECIFIERS } from '../singletons';
import { REPO, removeDir, tempDir, testRuntime } from '../testing';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(removeDir));
});

async function project(): Promise<string> {
  const cwd = await tempDir();
  dirs.push(cwd);
  expect(await main(['init', 'app', '--yes', '--no-install', '--cwd', cwd], testRuntime())).toBe(0);
  return path.join(cwd, 'app');
}

async function run(
  root: string,
  ...argv: string[]
): Promise<{ code: number; result: ReportResult }> {
  const rt = testRuntime();
  const code = await main([...argv, '--json', '--cwd', root], rt);
  const value: unknown = JSON.parse(rt.io.out.join(''));
  expect(validateResult(value)).toEqual([]);
  return { code, result: value as ReportResult };
}

const codes = (r: ReportResult) => r.findings.map((f) => f.code);

async function install(app: string, name: string, version: string): Promise<void> {
  const dir = path.join(app, 'node_modules', ...name.split('/'));
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name, version }));
}

async function editJson(file: string, edit: (doc: Record<string, unknown>) => void): Promise<void> {
  const doc = JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, unknown>;
  edit(doc);
  await fs.writeFile(file, JSON.stringify(doc, null, 2));
}

describe('the singleton list', () => {
  it('equals the list @mfeflow/rsbuild shares', () => {
    expect([...SINGLETON_SPECIFIERS]).toEqual([...DEFAULT_SINGLETONS]);
  });
});

describe('mfeflow doctor', () => {
  it('passes on a fresh project, env checks included', async () => {
    const root = await project();
    const { code, result } = await run(root, 'doctor');
    expect(code).toBe(0);
    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
    const env = result.checks.filter((c) => c.id.startsWith('env.'));
    expect(env.map((c) => [c.id, c.status])).toEqual([
      ['env.example', 'pass'],
      ['env.runtime-config', 'pass'],
      ['env.public-prefix', 'pass'],
      ['env.turbo', 'pass'],
    ]);
    expect(result.checks.map((c) => c.id)).toContain('plugins.imports');
  });

  it('skips the env checks when env-t3 is not installed', async () => {
    const cwd = await tempDir();
    dirs.push(cwd);
    const features = '--features=lint-oxlint';
    expect(
      await main(['init', 'app', '--yes', '--no-install', features, '--cwd', cwd], testRuntime()),
    ).toBe(0);
    const { result } = await run(path.join(cwd, 'app'), 'doctor');
    const env = result.checks.filter((c) => c.id.startsWith('env.'));
    expect(env).toHaveLength(4);
    for (const check of env) {
      expect(check.status).toBe('skipped');
      expect(check.skipped).toContain('env-t3');
    }
  });

  it('prints one line per check, then findings with fix and docs link', async () => {
    const root = await project();
    await fs.rm(path.join(root, 'apps/cart/mfeflow.app.json'));
    const rt = testRuntime();
    expect(await main(['doctor', '--cwd', root], rt)).toBe(3);
    const text = rt.io.out.join('\n');
    expect(text).toContain('FAIL  every app has a valid mfeflow.app.json');
    expect(text).toContain('error MFEFLOW_E113');
    expect(text).toContain('https://mfeflow.github.io/mfeflow/errors/E113');
  });

  it('reports an app that is gone, a missing or broken mfeflow.app.json, and names that disagree', async () => {
    const root = await project();
    await fs.rm(path.join(root, 'apps/cart'), { recursive: true });
    await fs.rm(path.join(root, 'apps/catalog/mfeflow.app.json'));
    await fs.writeFile(path.join(root, 'apps/shell/mfeflow.app.json'), '{ nope');
    const { code, result } = await run(root, 'doctor');
    expect(code).toBe(3);
    expect(codes(result)).toEqual(expect.arrayContaining(['MFEFLOW_E112', 'MFEFLOW_E113']));
    expect(result.findings.filter((f) => f.code === 'MFEFLOW_E113')).toHaveLength(2);
    await editJson(path.join(root, 'apps/catalog/mfeflow.app.json'), () => undefined).catch(
      () => undefined,
    );
    await fs.writeFile(
      path.join(root, 'apps/catalog/mfeflow.app.json'),
      JSON.stringify({ name: 'other', owner: 'x', shells: [], routes: [], exposes: [] }),
    );
    expect(codes((await run(root, 'doctor')).result)).toContain('MFEFLOW_E116');
  });

  it('finds two apps on one port and two remotes on one route', async () => {
    const root = await project();
    await editJson(path.join(root, 'mfeflow.json'), (doc) => {
      (doc.apps as Record<string, { port: number }>).cart!.port = 4311;
    });
    await editJson(path.join(root, 'apps/cart/mfeflow.app.json'), (doc) => {
      doc.routes = ['/catalog'];
    });
    const { result } = await run(root, 'doctor');
    expect(result.findings.map((f) => f.check).filter((c) => c !== 'files.drift')).toEqual([
      'config.ports',
      'config.routes',
    ]);
    expect(result.findings[0]?.message).toContain('catalog and cart both use 4311');
  });

  it('finds a wildcard route that covers another remote route and names both', async () => {
    const root = await project();
    await editJson(path.join(root, 'apps/catalog/mfeflow.app.json'), (doc) => {
      doc.routes = ['/shop/*'];
    });
    await editJson(path.join(root, 'apps/cart/mfeflow.app.json'), (doc) => {
      doc.routes = ['/Shop/cart'];
    });
    const { result } = await run(root, 'doctor');
    const found = result.findings.filter((f) => f.code === 'MFEFLOW_E116');
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain('cart route /Shop/cart overlaps catalog route /shop/*');
  });

  it('flags a missing or invalid registry entry, and fixes only the missing one', async () => {
    const root = await project();
    await fs.rm(path.join(root, 'registry/envs/staging/cart.json'));
    await fs.rm(path.join(root, 'registry/envs/dev/catalog.json'));
    await fs.writeFile(path.join(root, 'registry/envs/prod/cart.json'), '{"version": 3}');
    const before = await run(root, 'doctor');
    expect(before.result.findings.filter((f) => f.fixable)).toHaveLength(2);

    const dry = await run(root, 'doctor', '--fix', '--dry-run');
    expect(dry.result.summary.fixed).toBe(0);
    await expect(fs.access(path.join(root, 'registry/envs/staging/cart.json'))).rejects.toThrow();

    const fixed = await run(root, 'doctor', '--fix', '--yes');
    expect(fixed.result.summary.fixed).toBe(2);
    const left = fixed.result.findings.filter((f) => f.code === 'MFEFLOW_E114');
    expect(left).toHaveLength(1);
    expect(left[0]?.path).toBe('registry/envs/prod/cart.json');
    const dev = await fs.readFile(path.join(root, 'registry/envs/dev/catalog.json'), 'utf8');
    expect(dev).toContain('"manifestUrl": "http://localhost:4311/mf-manifest.json"');
  });

  it('--fix gives a remote with no port the next free one instead of writing localhost:0', async () => {
    const root = await project();
    await editJson(path.join(root, 'mfeflow.json'), (doc) => {
      delete (doc.apps as Record<string, { port?: number }>).cart!.port;
    });
    await fs.rm(path.join(root, 'registry/envs/dev/cart.json'));
    const fixed = await run(root, 'doctor', '--fix', '--yes');
    expect(fixed.result.summary.fixed).toBe(1);
    const saved = JSON.parse(await fs.readFile(path.join(root, 'mfeflow.json'), 'utf8')) as {
      apps: Record<string, { port?: number }>;
    };
    const used = ['shell', 'catalog'].map((name) => saved.apps[name]?.port);
    const port = saved.apps.cart?.port;
    expect(port).toBeGreaterThan(0);
    expect(used).not.toContain(port);
    const dev = await fs.readFile(path.join(root, 'registry/envs/dev/cart.json'), 'utf8');
    expect(dev).toContain(`"manifestUrl": "http://localhost:${String(port)}/mf-manifest.json"`);
    expect(dev).not.toContain('localhost:0');
  });

  it('warns about a registry entry without a remote', async () => {
    const root = await project();
    await fs.writeFile(
      path.join(root, 'registry/envs/dev/ghost.json'),
      '{"version":"1","manifestUrl":"http://x.test/m.json"}',
    );
    const { code, result } = await run(root, 'doctor');
    expect(code).toBe(0);
    expect(result.findings).toMatchObject([{ code: 'MFEFLOW_E114', severity: 'warning' }]);
  });

  it('finds a workspace package without a version and --fix gives it 0.0.0 in place', async () => {
    const root = await project();
    await fs.mkdir(path.join(root, 'packages/ui'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'packages/ui/package.json'),
      '{\n  "name": "@app/ui",\n  "type": "module"\n}\n',
    );
    const { code, result } = await run(root, 'doctor');
    expect(code).toBe(3);
    expect(codes(result)).toEqual(['MFEFLOW_E111']);
    await run(root, 'doctor', '--fix', '--yes');
    const text = await fs.readFile(path.join(root, 'packages/ui/package.json'), 'utf8');
    expect(JSON.parse(text)).toEqual({ name: '@app/ui', version: '0.0.0', type: 'module' });
    expect(text).toBe('{\n  "name": "@app/ui",\n  "version": "0.0.0",\n  "type": "module"\n}\n');
    expect((await run(root, 'doctor')).code).toBe(0);
  });

  it('warns when a copied file changed, without failing', async () => {
    const root = await project();
    await fs.appendFile(path.join(root, '.oxlintrc.json'), '\n');
    await fs.writeFile(path.join(root, '.oxlintrc.json'), '{ "changed": true }');
    const { code, result } = await run(root, 'doctor');
    expect(code).toBe(0);
    expect(result.findings).toMatchObject([{ code: 'MFEFLOW_E117', severity: 'warning' }]);
  });

  it('finds a singleton installed in two versions, naming the apps', async () => {
    const root = await project();
    await install(path.join(root, 'apps/shell'), 'react', '19.3.1');
    await install(path.join(root, 'apps/cart'), 'react', '18.3.1');
    const { code, result } = await run(root, 'doctor');
    expect(code).toBe(5);
    const [single, ...others] = result.findings.filter((f) => f.code === 'MFEFLOW_E301');
    expect(others).toEqual([]);
    expect(single?.message).toMatch(/react .*react\/jsx-runtime.*18\.3\.1.*cart 18\.3\.1/);
    expect(single?.message).toContain('shell 19.3.1');
  });

  it.each([
    '@mfeflow/analytics',
    '@mfeflow/telemetry',
    '@mfeflow/event-bus',
    '@tanstack/react-query',
    'i18next',
    'react-i18next',
  ])('finds %s installed in two versions', async (name) => {
    const root = await project();
    await install(path.join(root, 'apps/shell'), name, '1.0.0');
    await install(path.join(root, 'apps/cart'), name, '1.1.0');
    const { code, result } = await run(root, 'doctor');
    expect(code).toBe(5);
    const found = result.findings.filter((f) => f.code === 'MFEFLOW_E301');
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain(`${name} (`);
    expect(found[0]?.message).toContain('shell 1.0.0');
    expect(found[0]?.message).toContain('cart 1.1.0');
  });

  it.each(['link:../react', 'workspace:*', 'catalog:missing', 'latest'])(
    'warns, and does not crash, when react is %s and nothing is installed',
    async (spec) => {
      const root = await project();
      await editJson(path.join(root, 'apps/shell/package.json'), (doc) => {
        (doc.dependencies as Record<string, string>).react = spec;
      });
      const { code, result } = await run(root, 'doctor');
      expect(code).toBe(0);
      const warned = result.findings.filter((f) => f.code === 'MFEFLOW_E301');
      expect(warned).toHaveLength(1);
      expect(warned[0]).toMatchObject({ severity: 'warning' });
      expect(warned[0]?.message).toContain(`shell ${spec}`);
      expect(warned[0]?.message).toContain('until install');
    },
  );

  it('uses the installed version when the declared spec names none', async () => {
    const root = await project();
    await editJson(path.join(root, 'apps/shell/package.json'), (doc) => {
      (doc.dependencies as Record<string, string>).react = 'link:../react';
    });
    await install(path.join(root, 'apps/shell'), 'react', '19.3.1');
    await install(path.join(root, 'apps/cart'), 'react', '19.3.1');
    const { result } = await run(root, 'doctor');
    expect(codes(result)).not.toContain('MFEFLOW_E301');
  });

  it('exits with the lowest range when errors span several', async () => {
    const root = await project();
    await install(path.join(root, 'apps/shell'), 'react', '19.3.1');
    await install(path.join(root, 'apps/cart'), 'react', '18.3.1');
    await fs.rm(path.join(root, 'apps/catalog/mfeflow.app.json'));
    const { code, result } = await run(root, 'doctor');
    expect(codes(result)).toEqual(expect.arrayContaining(['MFEFLOW_E113', 'MFEFLOW_E301']));
    expect(code).toBe(3);
  });

  it('finds a runtime plugin that imports a shared module, also through a relative import', async () => {
    const root = await project();
    const dir = path.join(root, 'apps/shell/src/runtime-plugins');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, 'retry.ts'),
      "import { helper } from './helper';\nexport default () => helper;\n",
    );
    await fs.writeFile(
      path.join(dir, 'helper.ts'),
      "// import 'react' in a comment is fine\nimport { useState } from 'react';\nexport const helper = useState;\n",
    );
    const { result } = await run(root, 'doctor');
    expect(result.findings).toMatchObject([
      { code: 'MFEFLOW_E303', app: 'shell', path: 'apps/shell/src/runtime-plugins/helper.ts' },
    ]);
  });

  it('finds a runtime plugin the rsbuild config lists, and ignores one that imports nothing shared', async () => {
    const root = await project();
    await fs.mkdir(path.join(root, 'apps/cart/plugins'), { recursive: true });
    await fs.writeFile(path.join(root, 'apps/cart/plugins/a.ts'), "import 'react-dom/client';\n");
    await fs.writeFile(
      path.join(root, 'apps/cart/plugins/b.ts'),
      "import fs from 'node:fs';\nexport default fs;\n",
    );
    await fs.appendFile(
      path.join(root, 'apps/cart/rsbuild.config.ts'),
      "\nconst x = { runtimePlugins: ['./plugins/a.ts', './plugins/b.ts'] };\n",
    );
    const { result } = await run(root, 'doctor');
    expect(result.findings.filter((f) => f.code === 'MFEFLOW_E303').map((f) => f.path)).toEqual([
      'apps/cart/plugins/a.ts',
    ]);
  });

  it('reports a linked checkout that is not built', async () => {
    const root = await project();
    const checkout = path.join(root, '..', 'checkout');
    await fs.mkdir(path.join(checkout, 'packages/runtime'), { recursive: true });
    await fs.writeFile(
      path.join(checkout, 'packages/runtime/package.json'),
      JSON.stringify({ name: '@mfeflow/runtime', exports: { '.': './dist/index.js' } }),
    );
    await editJson(path.join(root, 'mfeflow.json'), (doc) => {
      doc.local = '../checkout';
    });
    expect(codes((await run(root, 'doctor')).result)).toEqual(['MFEFLOW_E110']);
    await fs.mkdir(path.join(checkout, 'packages/runtime/dist'));
    expect((await run(root, 'doctor')).result.findings).toEqual([]);
    await editJson(path.join(root, 'mfeflow.json'), (doc) => {
      doc.local = '../nowhere';
    });
    expect(codes((await run(root, 'doctor')).result)).toEqual(['MFEFLOW_E110']);
  });

  it('refuses an unknown flag and a folder with no project', async () => {
    const root = await project();
    const rt = testRuntime();
    expect(await main(['doctor', '--fixx', '--cwd', root], rt)).toBe(2);
    const empty = await tempDir();
    dirs.push(empty);
    const none = testRuntime();
    expect(await main(['doctor', '--cwd', empty], none)).toBe(3);
    expect(none.io.err.join('\n')).toContain('MFEFLOW_E102');
  });

  it('reports a broken mfeflow.json as an error, not a crash', async () => {
    const root = await project();
    await fs.writeFile(path.join(root, 'mfeflow.json'), '{"version": 2}');
    const rt = testRuntime();
    expect(await main(['validate', '--cwd', root], rt)).toBe(3);
    expect(rt.io.err.join('\n')).toContain('MFEFLOW_E104');
  });
});

describe('mfeflow validate', () => {
  it('runs only the schema checks', async () => {
    const root = await project();
    await fs.rm(path.join(root, 'registry/envs/dev/cart.json'));
    await install(path.join(root, 'apps/shell'), 'react', '19.3.1');
    await install(path.join(root, 'apps/cart'), 'react', '18.3.1');
    const { code, result } = await run(root, 'validate');
    expect(code).toBe(3);
    expect(codes(result)).toEqual(['MFEFLOW_E114']);
    expect(result.command).toBe('validate');
  });
});

describe('mfeflow check-compat', () => {
  it('passes when the shell provides what each remote uses', async () => {
    const root = await project();
    await install(path.join(root, 'apps/shell'), 'react', '19.3.1');
    await install(path.join(root, 'apps/cart'), 'react', '19.2.0');
    const { code, result } = await run(root, 'check-compat');
    expect(code).toBe(0);
    expect(result.checks).toHaveLength(1);
  });

  it('fails when a remote asks for a major the shell does not have', async () => {
    const root = await project();
    await install(path.join(root, 'apps/shell'), 'react', '19.3.1');
    await install(path.join(root, 'apps/cart'), 'react', '18.3.1');
    const { code, result } = await run(root, 'check-compat');
    expect(code).toBe(5);
    expect(result.findings[0]?.message).toContain('cart uses react 18.3.1, shell provides 19.3.1');
  });

  it("checks the remote's mfeflow.app.json platform ranges", async () => {
    const root = await project();
    await install(path.join(root, 'apps/shell'), '@mfeflow/runtime', '0.3.0');
    await editJson(path.join(root, 'apps/cart/mfeflow.app.json'), (doc) => {
      doc.platform = { '@mfeflow/runtime': '^0.2' };
    });
    const { result } = await run(root, 'check-compat');
    expect(result.findings[0]?.message).toContain(
      'cart needs @mfeflow/runtime ^0.2 (mfeflow.app.json platform) but shell has 0.3.0',
    );
    await editJson(path.join(root, 'apps/cart/mfeflow.app.json'), (doc) => {
      doc.platform = { '@mfeflow/runtime': '^0.3', react: '^19' };
    });
    expect((await run(root, 'check-compat')).result.findings).toEqual([]);
  });

  it('compares declared versions when nothing is installed', async () => {
    const root = await project();
    await editJson(path.join(root, 'apps/cart/mfeflow.app.json'), (doc) => {
      doc.platform = { react: '^18' };
    });
    expect(codes((await run(root, 'check-compat')).result)).toEqual(['MFEFLOW_E302']);
  });

  it('warns, and does not crash, when the shell or a remote has an unresolved react', async () => {
    const root = await project();
    await editJson(path.join(root, 'apps/shell/package.json'), (doc) => {
      (doc.dependencies as Record<string, string>).react = 'workspace:*';
    });
    await editJson(path.join(root, 'apps/cart/mfeflow.app.json'), (doc) => {
      doc.platform = { react: '^18' };
    });
    const { code, result } = await run(root, 'check-compat');
    expect(code).toBe(0);
    expect(result.findings).toMatchObject([{ code: 'MFEFLOW_E302', severity: 'warning' }]);
    expect(result.findings[0]?.message).toContain('until install');
  });
});

describe('doctor with a project linked through symlinked folders', () => {
  it('keeps the recorded --local path right when the root and checkout are reached via symlinks', async () => {
    const base = await tempDir();
    dirs.push(base);
    const parent = path.join(base, 'real', 'deep', 'parent');
    await fs.mkdir(parent, { recursive: true });
    const viaParent = path.join(base, 'via');
    const viaCheckout = path.join(base, 'ck');
    await fs.symlink(parent, viaParent);
    await fs.symlink(REPO, viaCheckout);

    expect(
      await main(
        ['init', 'app', '--yes', '--no-install', '--local', viaCheckout, '--cwd', viaParent],
        testRuntime(),
      ),
    ).toBe(0);
    const app = path.join(viaParent, 'app');
    expect(
      await main(['add', 'remote', 'orders', '--yes', '--no-install', '--cwd', app], testRuntime()),
    ).toBe(0);

    for (const cwd of [app, path.join(parent, 'app')]) {
      const { code, result } = await run(cwd, 'doctor');
      expect(codes(result)).not.toContain('MFEFLOW_E110');
      expect(code).toBe(0);
    }
    const manifest = JSON.parse(await fs.readFile(path.join(app, 'mfeflow.json'), 'utf8')) as {
      local: string;
    };
    expect(await fs.realpath(path.resolve(parent, 'app', manifest.local))).toBe(
      await fs.realpath(REPO),
    );
    for (const name of ['shell', 'orders']) {
      const dir = path.join(parent, 'app', 'apps', name);
      const pkg = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8')) as {
        dependencies: Record<string, string>;
      };
      const links = Object.entries(pkg.dependencies).filter(([, v]) => v.startsWith('link:'));
      expect(links.length).toBeGreaterThan(0);
      for (const [dep, spec] of links) {
        const target = await fs.realpath(path.resolve(dir, spec.slice('link:'.length)));
        expect(target).toBe(
          path.join(await fs.realpath(REPO), 'packages', dep.split('/')[1] ?? ''),
        );
      }
    }
  });
});

/** Findings of the env checks; the files these tests overwrite also show up as drift (E117). */
const envFindings = (result: ReportResult) =>
  result.findings.filter((f) => f.check.startsWith('env.'));

describe('the env-t3 checks', () => {
  const ENV_TS = (keys: string) => `import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export const env = createEnv({
  server: {
${keys}
  },
  runtimeEnv: process.env,
});
`;

  it('warns when a required key is missing from .env.example, or .env.example has a stale one', async () => {
    const root = await project();
    await fs.writeFile(
      path.join(root, 'apps/cart/env.ts'),
      ENV_TS('    API_ORIGIN: z.url(),\n    LOG_LEVEL: z.string().optional(),'),
    );
    await fs.writeFile(path.join(root, 'apps/cart/.env.example'), 'OLD_KEY=1\n');
    const { code, result } = await run(root, 'doctor');
    expect(code).toBe(0);
    const messages = result.findings.filter((f) => f.code === 'MFEFLOW_E118').map((f) => f.message);
    expect(messages).toHaveLength(2);
    expect(messages.join('\n')).toContain('API_ORIGIN is in apps/cart/env.ts but not in');
    expect(messages.join('\n')).toContain('OLD_KEY is in apps/cart/.env.example but not in');
    expect(messages.join('\n')).not.toContain('LOG_LEVEL');
    expect(envFindings(result).every((f) => f.severity === 'warning')).toBe(true);
    expect(envFindings(result)[0]?.docs).toBe('https://mfeflow.github.io/mfeflow/errors/E118');
  });

  it('reports a missing .env.example only when a key needs one, and an env.ts it cannot read', async () => {
    const root = await project();
    await fs.rm(path.join(root, 'apps/cart/.env.example'));
    expect(codes((await run(root, 'doctor')).result).filter((c) => c !== 'MFEFLOW_E117')).toEqual(
      [],
    );
    await fs.writeFile(path.join(root, 'apps/cart/env.ts'), ENV_TS('    API_ORIGIN: z.url(),'));
    expect(codes((await run(root, 'doctor')).result).filter((c) => c !== 'MFEFLOW_E117')).toContain(
      'MFEFLOW_E118',
    );
  });

  it('warns about an env.ts it cannot read instead of passing it silently', async () => {
    const root = await project();
    await fs.writeFile(path.join(root, 'apps/cart/env.ts'), 'export const env = {');
    await fs.writeFile(path.join(root, 'apps/catalog/env.ts'), 'export const env = {};\n');
    const found = envFindings((await run(root, 'doctor')).result)
      .filter((f) => f.code === 'MFEFLOW_E118')
      .toSorted((a, b) => (a.path ?? '').localeCompare(b.path ?? ''));
    expect(found.map((f) => [f.severity, f.path, f.app])).toEqual([
      ['warning', 'apps/cart/env.ts', 'cart'],
      ['warning', 'apps/catalog/env.ts', 'catalog'],
    ]);
    expect(found[0]?.message).toContain('apps/cart/env.ts cannot be checked');
    expect(found[1]?.message).toContain('it has no createEnv({ server: { … } })');
  });

  it('errors on a runtime-config file with a missing key, bad JSON or a non-object, and warns on an unknown key', async () => {
    const root = await project();
    const config = (name: string) => path.join(root, 'apps/shell/public/config', name);
    await fs.writeFile(config('runtime-config.prod.json'), '{}');
    await fs.writeFile(config('runtime-config.staging.json'), '{ nope');
    await fs.writeFile(config('runtime-config.dev.json'), '[]');
    await fs.writeFile(config('runtime-config.json'), '{"environment":"dev","extra":1}');
    const { code, result } = await run(root, 'doctor');
    expect(code).toBe(3);
    const found = result.findings.filter((f) => f.code === 'MFEFLOW_E119');
    expect(found.map((f) => [f.severity, f.message.split(': ')[1]])).toEqual([
      ['error', 'apps/shell/public/config/runtime-config.dev.json is not a JSON object'],
      [
        'warning',
        'apps/shell/public/config/runtime-config.json has extra, which the schema does not',
      ],
      ['error', expect.stringContaining('runtime-config.prod.json is missing environment')],
      ['error', expect.stringContaining('runtime-config.staging.json is not valid JSON')],
    ]);
  });

  it('does not require a key the schema marks optional, and flags a schema it cannot find', async () => {
    const root = await project();
    const schema = path.join(root, 'apps/shell/src/config/schema.ts');
    await fs.writeFile(
      schema,
      "import { z } from 'zod';\nexport const runtimeConfigSchema = z.object({\n  environment: z.string(),\n  flag: z.boolean().optional(),\n});\n",
    );
    expect(codes((await run(root, 'doctor')).result).filter((c) => c !== 'MFEFLOW_E117')).toEqual(
      [],
    );
    await fs.writeFile(schema, 'export const other = 1;\n');
    expect(codes((await run(root, 'doctor')).result).filter((c) => c !== 'MFEFLOW_E117')).toEqual([
      'MFEFLOW_E119',
    ]);
    await fs.writeFile(schema, 'export const runtimeConfigSchema = {');
    expect(codes((await run(root, 'doctor')).result).filter((c) => c !== 'MFEFLOW_E117')).toEqual([
      'MFEFLOW_E119',
    ]);
  });

  it('warns on a PUBLIC_ variable anywhere in an app but not on the two constants', async () => {
    const root = await project();
    await fs.writeFile(
      path.join(root, 'apps/cart/src/api/endpoints.ts'),
      'export const a = process.env.PUBLIC_API_URL;\nexport const n = process.env.PUBLIC_APP_NAME;\nexport const v = process.env.PUBLIC_BUILD_VERSION;\n',
    );
    await fs.appendFile(path.join(root, 'apps/shell/.env.example'), 'PUBLIC_GTM_ID=GTM-1\n');
    const { code, result } = await run(root, 'doctor');
    expect(code).toBe(0);
    const messages = result.findings.filter((f) => f.code === 'MFEFLOW_E120').map((f) => f.message);
    expect(messages.toSorted()).toEqual([
      expect.stringContaining('PUBLIC_API_URL in apps/cart/src/api/endpoints.ts'),
      expect.stringContaining('PUBLIC_GTM_ID in apps/shell/.env.example'),
    ]);
  });

  it('warns when a required server key is missing from turbo.json, and is satisfied by globalEnv or a task env', async () => {
    const root = await project();
    await fs.writeFile(path.join(root, 'apps/cart/env.ts'), ENV_TS('    API_ORIGIN: z.url(),'));
    await fs.writeFile(path.join(root, 'apps/cart/.env.example'), 'API_ORIGIN=\n');
    const turbo = path.join(root, 'turbo.json');
    const missing = envFindings((await run(root, 'doctor')).result);
    expect(missing.map((f) => [f.code, f.path])).toEqual([['MFEFLOW_E121', 'turbo.json']]);
    await editJson(turbo, (doc) => {
      doc.globalEnv = ['API_ORIGIN'];
    });
    expect(envFindings((await run(root, 'doctor')).result)).toEqual([]);
    await editJson(turbo, (doc) => {
      delete doc.globalEnv;
      doc.tasks = { build: { env: ['API_ORIGIN'] } };
    });
    expect(envFindings((await run(root, 'doctor')).result)).toEqual([]);
  });

  it.each([
    ['globalEnv', (doc: Record<string, unknown>) => (doc.globalEnv = ['API_ORIGIN']), true],
    ['a globalEnv wildcard', (doc: Record<string, unknown>) => (doc.globalEnv = ['API_*']), true],
    [
      'tasks.build.env',
      (doc: Record<string, unknown>) => (doc.tasks = { build: { env: ['API_ORIGIN'] } }),
      true,
    ],
    [
      'tasks.build.env wildcard',
      (doc: Record<string, unknown>) => (doc.tasks = { build: { env: ['*_ORIGIN'] } }),
      true,
    ],
    [
      'the app build task',
      (doc: Record<string, unknown>) =>
        (doc.tasks = { '@app/cart#build': { env: ['API_ORIGIN'] } }),
      true,
    ],
    [
      'another app build task',
      (doc: Record<string, unknown>) =>
        (doc.tasks = { '@app/shell#build': { env: ['API_ORIGIN'] } }),
      false,
    ],
    [
      'globalPassThroughEnv',
      (doc: Record<string, unknown>) => (doc.globalPassThroughEnv = ['API_ORIGIN']),
      false,
    ],
    [
      'build passThroughEnv',
      (doc: Record<string, unknown>) => (doc.tasks = { build: { passThroughEnv: ['API_ORIGIN'] } }),
      false,
    ],
    [
      'the env of a task that is not build',
      (doc: Record<string, unknown>) => (doc.tasks = { dev: { env: ['API_ORIGIN'] } }),
      false,
    ],
    [
      'a wildcard that does not match',
      (doc: Record<string, unknown>) => (doc.globalEnv = ['API_X*']),
      false,
    ],
    [
      'a negated wildcard',
      (doc: Record<string, unknown>) => (doc.globalEnv = ['API_*', '!API_ORIGIN']),
      false,
    ],
  ])('E121 counts %s as listing the key: %s', async (_name, edit, satisfied) => {
    const root = await project();
    await fs.writeFile(path.join(root, 'apps/cart/env.ts'), ENV_TS('    API_ORIGIN: z.url(),'));
    await fs.writeFile(path.join(root, 'apps/cart/.env.example'), 'API_ORIGIN=\n');
    await editJson(path.join(root, 'turbo.json'), edit);
    const found = envFindings((await run(root, 'doctor')).result).filter(
      (f) => f.code === 'MFEFLOW_E121',
    );
    expect(found.length).toBe(satisfied ? 0 : 1);
  });

  it('skips the turbo check without a turbo.json or with one that is not JSON', async () => {
    const root = await project();
    await fs.rm(path.join(root, 'turbo.json'));
    let check = (await run(root, 'doctor')).result.checks.find((c) => c.id === 'env.turbo');
    expect(check?.skipped).toContain('no turbo.json');
    await fs.writeFile(path.join(root, 'turbo.json'), '{ nope');
    check = (await run(root, 'doctor')).result.checks.find((c) => c.id === 'env.turbo');
    expect(check?.skipped).toContain('not valid JSON');
  });
});

describe('doctor when the shell is not in the repo', () => {
  it('tells you to run doctor --against', async () => {
    const root = await project();
    await fs.rm(path.join(root, 'apps/shell'), { recursive: true });
    const { result } = await run(root, 'doctor');
    const messages = result.findings.filter((f) => f.check === 'compat').map((f) => f.message);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain(
      'shell is not in this repo, run `mfeflow doctor --against <url|file>`',
    );
  });
});

describe('doctor --against', () => {
  const shellManifest = (react: string) =>
    JSON.stringify({ name: 'shell', shared: [{ name: 'react', version: react, singleton: true }] });

  async function remoteRepo(): Promise<string> {
    const root = await project();
    await fs.rm(path.join(root, 'apps/shell'), { recursive: true });
    for (const remote of ['cart', 'catalog'])
      await install(path.join(root, 'apps', remote), 'react', '18.3.1');
    return root;
  }

  it('drops the shell-absent hint and reports a skewed react as E302', async () => {
    const root = await remoteRepo();
    const file = path.join(root, 'shell.json');
    await fs.writeFile(file, shellManifest('19.1.0'));
    const { code, result } = await run(root, 'doctor', '--against', file);
    expect(code).toBe(3);
    expect(result.against).toBe(file);
    const compat = result.findings.filter((f) => f.check === 'compat');
    expect(compat.length).toBeGreaterThan(0);
    expect(compat.every((f) => f.severity === 'error')).toBe(true);
    expect(compat.map((f) => f.message).join('\n')).not.toContain('not in this repo');
  });

  it('passes the compat check when the shell agrees, and still runs the other checks', async () => {
    const root = await remoteRepo();
    await fs.writeFile(path.join(root, 'shell.json'), shellManifest('18.3.1'));
    const { result } = await run(root, 'doctor', '--against', 'shell.json');
    expect(result.findings.filter((f) => f.check === 'compat')).toEqual([]);
    expect(result.checks.find((c) => c.id === 'compat')?.status).toBe('pass');
    expect(result.checks.length).toBeGreaterThan(5);
  });

  it('fails with E307 for a source it cannot read', async () => {
    const root = await remoteRepo();
    const rt = testRuntime();
    expect(
      await main(['doctor', '--against', 'missing.json', '--json', '--cwd', root], rt),
    ).not.toBe(0);
    expect(rt.io.out.join('') + rt.io.err.join('')).toContain('MFEFLOW_E307');
  });

  it('leaves doctor without the flag as it was', async () => {
    const root = await remoteRepo();
    const { result } = await run(root, 'doctor');
    expect(result.against).toBeUndefined();
    expect(result.findings.some((f) => f.message.includes('doctor --against'))).toBe(true);
  });
});

describe('the app file name', () => {
  const notices = (err: readonly string[]) => err.filter((line) => line.startsWith('Notice:'));

  it('reads mfeflow.app.json, with no notice', async () => {
    const root = await project();
    await expect(fs.access(path.join(root, 'apps/cart/mfe.json'))).rejects.toThrow();
    const rt = testRuntime();
    expect(await main(['validate', '--cwd', root], rt)).toBe(0);
    expect(notices(rt.io.err)).toEqual([]);
  });

  it('still reads the old mfe.json, with one notice per command even when doctor --fix inspects twice', async () => {
    const root = await project();
    for (const app of ['cart', 'shell'])
      await fs.rename(
        path.join(root, `apps/${app}/mfeflow.app.json`),
        path.join(root, `apps/${app}/mfe.json`),
      );
    await fs.rm(path.join(root, 'registry/envs/dev/cart.json'));
    const rt = testRuntime();
    expect(await main(['doctor', '--fix', '--yes', '--json', '--cwd', root], rt)).toBe(0);
    const result = JSON.parse(rt.io.out.join('')) as ReportResult;
    expect(result.summary.fixed).toBe(1);
    expect(codes(result)).not.toContain('MFEFLOW_E113');
    expect(notices(rt.io.err)).toEqual([
      'Notice: mfe.json is now mfeflow.app.json. Rename apps/cart/mfe.json, apps/shell/mfe.json; the old name still works for now.',
    ]);
  });

  it('points findings at the old file when that is the one in use', async () => {
    const root = await project();
    await fs.rename(
      path.join(root, 'apps/cart/mfeflow.app.json'),
      path.join(root, 'apps/cart/mfe.json'),
    );
    await editJson(path.join(root, 'apps/cart/mfe.json'), (doc) => {
      doc.name = 'other';
    });
    const { result } = await run(root, 'validate');
    expect(result.findings.find((f) => f.code === 'MFEFLOW_E116')?.path).toBe('apps/cart/mfe.json');
  });

  it('fails with E122 when an app has both files', async () => {
    const root = await project();
    await fs.copyFile(
      path.join(root, 'apps/cart/mfeflow.app.json'),
      path.join(root, 'apps/cart/mfe.json'),
    );
    const rt = testRuntime();
    expect(await main(['validate', '--cwd', root], rt)).toBe(3);
    const text = rt.io.err.join('\n');
    expect(text).toContain('MFEFLOW_E122 An app has both mfeflow.app.json and the old mfe.json');
    expect(text).toContain('https://mfeflow.github.io/mfeflow/errors/E122');
  });
});
