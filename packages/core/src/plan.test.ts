import { describe, expect, it } from 'vitest';
import { PlanBuilder, renderDiff, summarize, type ReadFile } from './plan.js';

const reader =
  (files: Record<string, string>): ReadFile =>
  (file) =>
    Promise.resolve(files[file]);

const pkg = (extra: object = {}) => `${JSON.stringify({ name: 'shell', ...extra }, null, 2)}\n`;

describe('PlanBuilder files', () => {
  it('turns create, patch and delete into changes, sorted by path', async () => {
    const b = new PlanBuilder(reader({ 'edit.txt': 'one\n', 'gone.txt': 'bye\n' }));
    await b.delete('gone.txt');
    await b.patch('edit.txt', (s) => `${s}two\n`);
    await b.create('new.txt', 'hello\n');
    const plan = b.build();
    expect(plan.changes.map((c) => [c.path, c.action, c.track])).toEqual([
      ['edit.txt', 'patch', false],
      ['gone.txt', 'delete', false],
      ['new.txt', 'create', true],
    ]);
    expect(plan.changes[0]).toMatchObject({ before: 'one\n', after: 'one\ntwo\n' });
    expect(plan.changes[1]).toMatchObject({ before: 'bye\n', after: null });
    expect(plan.changes[2]).toMatchObject({ before: null, after: 'hello\n' });
  });

  it('is JSON-serializable', async () => {
    const b = new PlanBuilder(reader({}));
    await b.create('a.txt', 'a');
    const plan = b.build();
    expect(JSON.parse(JSON.stringify(plan))).toEqual(plan);
  });

  it('leaves out edits that change nothing', async () => {
    const b = new PlanBuilder(reader({ 'a.txt': 'same' }));
    await b.patch('a.txt', (s) => s);
    await b.create('a.txt', 'same');
    await b.create('t.txt', 'x');
    await b.delete('t.txt');
    expect(b.build().changes).toEqual([]);
  });

  it('keeps patches to a file created in the same plan in one create', async () => {
    const b = new PlanBuilder(reader({}));
    await b.create('a.ts', 'a');
    await b.patch('a.ts', (s) => `${s}b`);
    expect(b.build().changes).toEqual([
      { path: 'a.ts', action: 'create', before: null, after: 'ab', track: true },
    ]);
  });

  it('refuses to create over a different existing file (E207) and to patch a missing one (E208)', async () => {
    const b = new PlanBuilder(reader({ 'a.txt': 'mine' }));
    await expect(b.create('a.txt', 'theirs')).rejects.toMatchObject({ code: 'MFEFLOW_E207' });
    await expect(b.patch('nope.txt', (s) => s)).rejects.toMatchObject({ code: 'MFEFLOW_E208' });
  });

  it('can create an untracked file', async () => {
    const b = new PlanBuilder(reader({}));
    await b.create('a.txt', 'a', false);
    expect(b.build().changes[0]?.track).toBe(false);
  });
});

describe('PlanBuilder package.json', () => {
  it('adds dependencies sorted, keeping indentation and the final newline', async () => {
    const source = `{\n    "name": "shell",\n    "dependencies": {\n        "zod": "^4.0.0"\n    }\n}\n`;
    const b = new PlanBuilder(reader({ 'package.json': source }));
    await b.addDependency('package.json', 'react', '^19.0.0');
    await b.addDependency('package.json', 'vitest', '^5.0.0', true);
    const after = b.build().changes[0]?.after ?? '';
    expect(after).toBe(
      `{\n    "name": "shell",\n    "dependencies": {\n        "react": "^19.0.0",\n        "zod": "^4.0.0"\n    },\n    "devDependencies": {\n        "vitest": "^5.0.0"\n    }\n}\n`,
    );
    expect(b.build().dependencies).toEqual([
      { file: 'package.json', name: 'react', range: '^19.0.0', dev: false },
      { file: 'package.json', name: 'vitest', range: '^5.0.0', dev: true },
    ]);
  });

  it('adds scripts and records them as shown-not-run', async () => {
    const b = new PlanBuilder(
      reader({ 'package.json': pkg({ scripts: { build: 'rsbuild build' } }) }),
    );
    await b.addScript('package.json', 'check', 'node check.js');
    const plan = b.build();
    expect(JSON.parse(plan.changes[0]?.after ?? '')).toMatchObject({
      scripts: { build: 'rsbuild build', check: 'node check.js' },
    });
    expect(plan.scripts).toEqual([
      { file: 'package.json', name: 'check', command: 'node check.js' },
    ]);
    expect(summarize(plan)).toContain('Scripts added to package.json, not run (1)');
  });

  it('fails clearly on a missing, broken or non-object package.json', async () => {
    const missing = new PlanBuilder(reader({}));
    await expect(missing.addScript('package.json', 'a', 'b')).rejects.toMatchObject({
      code: 'MFEFLOW_E208',
    });
    const broken = new PlanBuilder(reader({ 'package.json': '{' }));
    await expect(broken.addScript('package.json', 'a', 'b')).rejects.toMatchObject({
      code: 'MFEFLOW_E208',
    });
    const list = new PlanBuilder(reader({ 'package.json': '[]' }));
    await expect(list.addScript('package.json', 'a', 'b')).rejects.toMatchObject({
      code: 'MFEFLOW_E208',
    });
  });

  it('records env keys', () => {
    const b = new PlanBuilder(reader({}));
    b.addEnvKey('public/config/runtime-config.json', 'GTM_ID');
    expect(b.build().env).toEqual([{ file: 'public/config/runtime-config.json', key: 'GTM_ID' }]);
  });
});

describe('PlanBuilder catalog', () => {
  const workspace = '# versions\ncatalog:\n  react: 19.3.1 # keep\n';

  it('uses catalog: for a dependency already in the catalog', async () => {
    const b = new PlanBuilder(reader({ 'package.json': pkg(), 'pnpm-workspace.yaml': workspace }), {
      catalog: true,
    });
    await b.addDependency('package.json', 'react', '^19.0.0');
    const plan = b.build();
    expect(plan.dependencies[0]?.range).toBe('catalog:');
    expect(plan.changes.map((c) => c.path)).toEqual(['package.json']);
    expect(plan.warnings).toEqual([
      'react is 19.3.1 in the catalog; using that instead of ^19.0.0',
    ]);
  });

  it('adds a new dependency to the catalog, keeping comments', async () => {
    const b = new PlanBuilder(reader({ 'package.json': pkg(), 'pnpm-workspace.yaml': workspace }), {
      catalog: true,
    });
    await b.addDependency('package.json', 'zod', '4.1.0');
    const plan = b.build();
    const yamlAfter = plan.changes.find((c) => c.path === 'pnpm-workspace.yaml')?.after ?? '';
    expect(yamlAfter).toContain('# versions');
    expect(yamlAfter).toContain('react: 19.3.1 # keep');
    expect(yamlAfter).toContain('zod: 4.1.0');
    expect(plan.dependencies[0]?.range).toBe('catalog:');
  });

  it('keeps plain ranges without a workspace file, with catalog off, or for workspace: and catalog: ranges', async () => {
    const files = { 'package.json': pkg(), 'pnpm-workspace.yaml': workspace };
    const noWorkspace = new PlanBuilder(reader({ 'package.json': pkg() }), { catalog: true });
    await noWorkspace.addDependency('package.json', 'zod', '^4.0.0');
    expect(noWorkspace.build().dependencies[0]?.range).toBe('^4.0.0');
    const off = new PlanBuilder(reader(files));
    await off.addDependency('package.json', 'zod', '^4.0.0');
    expect(off.build().dependencies[0]?.range).toBe('^4.0.0');
    const pinned = new PlanBuilder(reader(files), { catalog: true });
    await pinned.addDependency('package.json', '@x/a', 'workspace:*');
    await pinned.addDependency('package.json', 'react', 'catalog:');
    expect(pinned.build().dependencies.map((d) => d.range)).toEqual(['workspace:*', 'catalog:']);
  });

  it('starts a catalog when the workspace file has none', async () => {
    const b = new PlanBuilder(
      reader({ 'package.json': pkg(), 'pnpm-workspace.yaml': 'packages:\n  - apps/*\n' }),
      {
        catalog: true,
      },
    );
    await b.addDependency('package.json', 'zod', '4.1.0');
    const yamlAfter = b.build().changes.find((c) => c.path === 'pnpm-workspace.yaml')?.after ?? '';
    expect(yamlAfter).toBe('packages:\n  - apps/*\ncatalog:\n  zod: 4.1.0\n');
  });
});

describe('renderDiff', () => {
  it('shows creates, patches and deletes as unified diffs', async () => {
    const b = new PlanBuilder(reader({ 'a.txt': 'one\ntwo\nthree\n', 'gone.txt': 'bye\n' }));
    await b.patch('a.txt', (s) => s.replace('two', '2'));
    await b.delete('gone.txt');
    await b.create('new.txt', 'hello\n');
    const diff = renderDiff(b.build());
    expect(diff).toContain('--- a/a.txt\n+++ b/a.txt');
    expect(diff).toContain('-two\n+2');
    expect(diff).toContain('--- a/gone.txt\n+++ /dev/null');
    expect(diff).toContain('-bye');
    expect(diff).toContain('--- /dev/null\n+++ b/new.txt');
    expect(diff).toContain('+hello');
  });

  it('is empty for an empty plan', () => {
    expect(renderDiff(new PlanBuilder(reader({})).build())).toBe('');
  });
});

describe('summarize', () => {
  it('counts changes and lists dependencies, env keys and warnings', async () => {
    const b = new PlanBuilder(reader({ 'package.json': pkg() }));
    await b.create('src/a.ts', 'a');
    await b.addDependency('package.json', 'zod', '^4.0.0', true);
    b.addEnvKey('runtime.json', 'KEY');
    b.warn('careful');
    const text = summarize(b.build());
    expect(text).toContain('1 to create, 1 to patch, 0 to delete');
    expect(text).toContain('create  src/a.ts');
    expect(text).toContain('patch   package.json');
    expect(text).toContain('package.json  zod@^4.0.0 (dev)');
    expect(text).toContain('runtime.json  KEY');
    expect(text).toContain('Warning: careful');
  });

  it('is one line for an empty plan', () => {
    expect(summarize(new PlanBuilder(reader({})).build())).toBe(
      '0 to create, 0 to patch, 0 to delete',
    );
  });
});
