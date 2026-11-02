import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { publicPackages } from './check-pack.mjs';
import {
  buildManifest,
  changelogSection,
  ciVersion,
  distTagFor,
  expectedPlan,
  hashesOf,
  isNotFound,
  isPrerelease,
  isPublished,
  pendingChangesets,
  policyProblems,
  publishAll,
  publishOrder,
  sha256,
  sharedVersion,
  tagsFor,
  tarballName,
  unpublished,
} from './release-plan.mjs';

const repo = path.resolve(import.meta.dirname, '..');
const pkg = (name, dependsOn = []) => ({ name, dependsOn });

const reply = (result) => () => result;

const onlyAPublished = (_c, args) =>
  args[1].startsWith('a@')
    ? { status: 0, stdout: '1.0.0', stderr: '' }
    : { status: 1, stdout: '', stderr: 'E404' };
const registryPackages = [
  { manifest: { name: 'a', version: '1.0.0' } },
  { manifest: { name: 'b', version: '1.0.0' } },
];

const failingNpm = (_c, args) =>
  args[0] === 'view'
    ? { status: 1, stdout: '', stderr: 'E404' }
    : { status: 1, stdout: '', stderr: 'EOTP' };

const recorder = (published = []) => {
  const calls = [];
  const run = (command, args) => {
    calls.push([command, ...args]);
    if (args[0] === 'view')
      return published.includes(args[1])
        ? { status: 0, stdout: args[1].split('@').at(-1), stderr: '' }
        : { status: 1, stdout: '', stderr: 'npm error code E404' };
    return { status: 0, stdout: '', stderr: '' };
  };
  return { calls, run };
};

const readWorkflow = (f) => fs.readFileSync(path.join(repo, '.github/workflows', f), 'utf8');

const jobs = (text) => {
  const body = text.split(/\njobs:\n/)[1];
  return Object.fromEntries(
    body.split(/\n(?=  [a-z-]+:\n)/).map((chunk) => [chunk.trim().split(':')[0], chunk]),
  );
};

const code = (text) => text.replace(/^\s*#.*$/gm, '');

describe('publishOrder', () => {
  it('puts contracts and core first and the CLI packages last', () => {
    const order = publishOrder([
      pkg('create-mfeflow', ['mfeflow']),
      pkg('mfeflow', ['@mfeflow/core']),
      pkg('@mfeflow/zeta'),
      pkg('@mfeflow/core', ['@mfeflow/contracts']),
      pkg('@mfeflow/alpha'),
      pkg('@mfeflow/contracts'),
    ]);
    expect(order).toEqual([
      '@mfeflow/contracts',
      '@mfeflow/core',
      '@mfeflow/alpha',
      '@mfeflow/zeta',
      'mfeflow',
      'create-mfeflow',
    ]);
  });

  it('puts a package after its public dependencies, whatever their names', () => {
    const order = publishOrder([
      pkg('@mfeflow/i18n', ['@mfeflow/storage', 'react']),
      pkg('@mfeflow/storage'),
    ]);
    expect(order).toEqual(['@mfeflow/storage', '@mfeflow/i18n']);
  });

  it('refuses a cycle', () => {
    expect(() => publishOrder([pkg('a', ['b']), pkg('b', ['a'])])).toThrow(/cycle/);
  });

  it('orders the real workspace with every package once and dependencies first', () => {
    const packages = publicPackages(repo).map((p) => ({
      name: p.manifest.name,
      dependsOn: Object.keys(p.manifest.dependencies ?? {}),
    }));
    const order = publishOrder(packages);
    expect(order).toHaveLength(packages.length);
    expect(order.slice(0, 2)).toEqual(['@mfeflow/contracts', '@mfeflow/core']);
    expect(order.slice(-2)).toEqual(['mfeflow', 'create-mfeflow']);
    for (const p of packages)
      for (const d of p.dependsOn.filter((n) => order.includes(n)))
        expect(order.indexOf(d)).toBeLessThan(order.indexOf(p.name));
  });
});

describe('pendingChangesets', () => {
  it('counts markdown files except the README and config', () => {
    expect(pendingChangesets(['README.md', 'config.json', 'a.md', 'b.md', 'pre.json'])).toEqual([
      'a.md',
      'b.md',
    ]);
    expect(pendingChangesets(['README.md', 'config.json'])).toEqual([]);
  });
});

describe('npm answers', () => {
  it('knows a 404', () => {
    expect(isNotFound('npm error code E404\nnpm error 404 Not Found - GET')).toBe(true);
    expect(isNotFound('npm error code ETIMEDOUT')).toBe(false);
  });

  it('says published when npm view prints the version', () => {
    expect(isPublished('a', '1.0.0', reply({ status: 0, stdout: '1.0.0\n', stderr: '' }))).toBe(
      true,
    );
  });

  it('says unpublished on a 404', () => {
    expect(
      isPublished('a', '1.0.0', reply({ status: 1, stdout: '', stderr: 'npm error code E404' })),
    ).toBe(false);
  });

  it('throws on any other failure instead of guessing', () => {
    expect(() =>
      isPublished('a', '1.0.0', reply({ status: 1, stdout: '', stderr: 'ETIMEDOUT' })),
    ).toThrow(/npm view a@1.0.0 failed/);
  });

  it('lists the packages that are not on npm', () => {
    expect(unpublished(registryPackages, onlyAPublished).map((p) => p.manifest.name)).toEqual([
      'b',
    ]);
  });
});

describe('versions and channels', () => {
  it('tells prereleases apart', () => {
    expect(isPrerelease('1.0.0-next.1')).toBe(true);
    expect(isPrerelease('1.0.0')).toBe(false);
  });

  it('publishes stable versions as latest and prereleases on the pre channel', () => {
    expect(distTagFor('1.0.0')).toBe('latest');
    expect(distTagFor('1.0.0-next.1', 'next')).toBe('next');
    expect(() => distTagFor('1.0.0-next.1')).toThrow(/no pre channel/);
  });

  it('builds the throwaway CI version', () => {
    expect(ciVersion(42)).toBe('0.0.0-ci.42');
  });

  it('names tarballs the way pnpm does', () => {
    expect(tarballName({ name: '@mfeflow/core', version: '0.1.0' })).toBe('mfeflow-core-0.1.0.tgz');
    expect(tarballName({ name: 'mfeflow', version: '0.1.0' })).toBe('mfeflow-0.1.0.tgz');
  });
});

const bytes = (name) => Buffer.from(`tarball of ${name}`);
const manifestOf = (version = '0.1.0', distTag = 'latest') => ({
  distTag,
  packages: [
    { name: '@mfeflow/core', version, tarball: 'mfeflow-core.tgz', sha256: sha256(bytes('core')) },
    { name: 'mfeflow', version, tarball: 'mfeflow.tgz', sha256: sha256(bytes('cli')) },
  ],
});

describe('buildManifest', () => {
  it('lists name, version, tarball and sha256 in the given order', () => {
    const tarballs = new Map([
      ['mfeflow', { file: 'mfeflow-0.1.0.tgz', bytes: bytes('cli') }],
      ['@mfeflow/core', { file: 'mfeflow-core-0.1.0.tgz', bytes: bytes('core') }],
    ]);
    const manifest = buildManifest({
      packages: [
        { name: 'mfeflow', version: '0.1.0' },
        { name: '@mfeflow/core', version: '0.1.0' },
      ],
      order: ['@mfeflow/core', 'mfeflow'],
      distTag: 'latest',
      tarballs,
    });
    expect(manifest).toEqual({
      distTag: 'latest',
      packages: [
        {
          name: '@mfeflow/core',
          version: '0.1.0',
          tarball: 'mfeflow-core-0.1.0.tgz',
          sha256: sha256(bytes('core')),
        },
        {
          name: 'mfeflow',
          version: '0.1.0',
          tarball: 'mfeflow-0.1.0.tgz',
          sha256: sha256(bytes('cli')),
        },
      ],
    });
  });
});

describe('hashesOf', () => {
  it('maps each tarball file to its sha256', () => {
    const tarballs = new Map([
      ['a', { file: 'a-1.0.0.tgz', bytes: bytes('a') }],
      ['b', { file: 'b-1.0.0.tgz', bytes: bytes('b') }],
    ]);
    expect(hashesOf(tarballs)).toEqual({
      'a-1.0.0.tgz': sha256(bytes('a')),
      'b-1.0.0.tgz': sha256(bytes('b')),
    });
  });
});

describe('expectedPlan', () => {
  const packages = [
    { name: 'mfeflow', version: '1.0.0', dependsOn: ['@mfeflow/core'] },
    { name: '@mfeflow/core', version: '1.0.0', dependsOn: [] },
  ];

  it('lists name, version, dist-tag and tarball in publish order', () => {
    expect(expectedPlan(packages)).toEqual([
      {
        name: '@mfeflow/core',
        version: '1.0.0',
        distTag: 'latest',
        tarball: 'mfeflow-core-1.0.0.tgz',
      },
      { name: 'mfeflow', version: '1.0.0', distTag: 'latest', tarball: 'mfeflow-1.0.0.tgz' },
    ]);
  });

  it('takes the pre channel as the dist-tag of a prerelease', () => {
    const pre = packages.map((p) => ({
      name: p.name,
      version: '1.0.0-next.1',
      dependsOn: p.dependsOn,
    }));
    expect(expectedPlan(pre, 'next').every((e) => e.distTag === 'next')).toBe(true);
    expect(() => expectedPlan(pre)).toThrow(/no pre channel/);
  });

  it('plans the real workspace', () => {
    const real = publicPackages(repo).map((p) => ({
      name: p.manifest.name,
      version: p.manifest.version,
      dependsOn: Object.keys(p.manifest.dependencies ?? {}),
    }));
    const plan = expectedPlan(real);
    expect(plan).toHaveLength(real.length);
    expect(plan.every((e) => /^[a-z0-9._-]+\.tgz$/.test(e.tarball))).toBe(true);
  });
});

describe('policyProblems', () => {
  it('accepts a stable release on latest and a prerelease on its channel', () => {
    expect(policyProblems(manifestOf('1.0.0', 'latest'))).toEqual([]);
    expect(policyProblems(manifestOf('1.0.0-next.2', 'next'))).toEqual([]);
  });

  it('refuses a prerelease on latest or on another channel', () => {
    expect(policyProblems(manifestOf('1.0.0-next.2', 'latest'))).toHaveLength(2);
    expect(policyProblems(manifestOf('1.0.0-beta.1', 'next'))).toHaveLength(2);
  });

  it('refuses a stable version on a pre channel', () => {
    expect(policyProblems(manifestOf('1.0.0', 'next'))).toHaveLength(2);
  });

  it('refuses mixed versions', () => {
    const manifest = manifestOf();
    manifest.packages[1].version = '0.2.0';
    expect(policyProblems(manifest)[0]).toMatch(/different versions/);
  });
});

describe('release names', () => {
  it('tags every package and the version', () => {
    expect(tagsFor(manifestOf())).toEqual(['@mfeflow/core@0.1.0', 'mfeflow@0.1.0', 'v0.1.0']);
  });

  it('needs one shared version', () => {
    expect(sharedVersion(manifestOf('2.0.0'))).toBe('2.0.0');
    const mixed = manifestOf();
    mixed.packages[0].version = '0.0.9';
    expect(() => sharedVersion(mixed)).toThrow(/shared version/);
    expect(() => sharedVersion({ packages: [] })).toThrow(/shared version/);
  });
});

describe('changelogSection', () => {
  const changelog = `# mfeflow

## 0.2.0

### Minor Changes

- add x

## 0.1.0

### Patch Changes

- first
`;

  it('returns the section of one version without its heading', () => {
    expect(changelogSection(changelog, '0.2.0')).toBe('### Minor Changes\n\n- add x');
    expect(changelogSection(changelog, '0.1.0')).toBe('### Patch Changes\n\n- first');
  });

  it('returns null for a missing or empty version', () => {
    expect(changelogSection(changelog, '9.9.9')).toBeNull();
    expect(changelogSection('## 1.0.0\n\n## 0.9.0\n- a', '1.0.0')).toBeNull();
  });
});

describe('publishAll', () => {
  it('publishes in order with provenance and skips what is already on npm', () => {
    const { calls, run } = recorder(['@mfeflow/core@0.1.0']);
    const done = publishAll(manifestOf(), 'release', run);
    expect(done.map((d) => d.action)).toEqual(['skipped', 'published']);
    const publishes = calls.filter((c) => c[1] === 'publish');
    expect(publishes).toEqual([
      [
        'npm',
        'publish',
        './release/mfeflow.tgz',
        '--access',
        'public',
        '--ignore-scripts',
        '--tag',
        'latest',
        '--provenance',
      ],
    ]);
  });

  it('is idempotent: a second run publishes nothing', () => {
    const { calls, run } = recorder(['@mfeflow/core@0.1.0', 'mfeflow@0.1.0']);
    expect(publishAll(manifestOf(), 'release', run).map((d) => d.action)).toEqual([
      'skipped',
      'skipped',
    ]);
    expect(calls.some((c) => c[1] === 'publish')).toBe(false);
  });

  it('uses the pre channel as the dist-tag', () => {
    const { calls, run } = recorder();
    publishAll(manifestOf('1.0.0-next.1', 'next'), 'release', run);
    expect(calls.filter((c) => c[1] === 'publish').every((c) => c.includes('next'))).toBe(true);
  });

  it('dry-runs without asking npm what is published and without provenance', () => {
    const { calls, run } = recorder(['mfeflow@0.1.0']);
    const done = publishAll(manifestOf(), 'release', run, { dryRun: true, tag: 'ci-dry-run' });
    expect(done.map((d) => d.action)).toEqual(['dry-run', 'dry-run']);
    expect(calls.every((c) => c[1] === 'publish' && c.includes('--dry-run'))).toBe(true);
    expect(calls.some((c) => c.includes('--provenance'))).toBe(false);
    expect(calls[0]).toContain('ci-dry-run');
  });

  it('stops at the first failed publish', () => {
    expect(() => publishAll(manifestOf(), 'release', failingNpm)).toThrow(/EOTP/);
  });
});

describe('the workflows', () => {
  const release = jobs(code(readWorkflow('release.yml')));

  it('keeps top-level permissions empty and every action pinned by SHA', () => {
    for (const f of ['release.yml', 'ci.yml', 'dependency-review.yml']) {
      const text = readWorkflow(f);
      expect(text).toMatch(/^permissions: \{\}$/m);
      for (const use of text.matchAll(/uses: (\S+)/g)) expect(use[1]).toMatch(/@[0-9a-f]{40}$/);
    }
  });

  it('does not hard-code the package count in the workflow or the README', () => {
    const readme = fs.readFileSync(path.join(repo, 'README.md'), 'utf8');
    for (const text of [readWorkflow('release.yml'), readme])
      expect(text).not.toMatch(/\b\d+ public packages/);
  });

  it('has the version, plan, pack, publish, image and tag jobs', () => {
    expect(Object.keys(release)).toEqual(['version', 'plan', 'pack', 'publish', 'image', 'tag']);
  });

  it('gives only the image job packages: write, after the publish, on ubuntu', () => {
    for (const [name, chunk] of Object.entries(release))
      expect(/packages: write/.test(chunk), name).toBe(name === 'image');
    expect(release.image).toMatch(/needs: \[plan, publish\]/);
    expect(release.image).toMatch(/runs-on: ubuntu-latest/);
  });

  it('gives only the publish job id-token and holds no npm token anywhere', () => {
    const text = code(readWorkflow('release.yml'));
    for (const [name, chunk] of Object.entries(release))
      expect(/id-token: write/.test(chunk)).toBe(name === 'publish');
    expect(text).not.toMatch(/NPM_TOKEN|NODE_AUTH_TOKEN/);
  });

  it('runs publish in the npm environment after plan and pack, with no repo code or install', () => {
    expect(release.publish).toMatch(/environment: npm/);
    expect(release.publish).toMatch(/needs: \[plan, pack\]/);
    expect(release.publish).not.toMatch(/actions\/checkout|node scripts|pnpm|npm (ci|install)/);
  });

  it('pins the publish Node to the exact version the CI dry run uses', () => {
    const exact = release.publish.match(/node-version: (\d+\.\d+\.\d+)/)?.[1];
    expect(exact).toBeDefined();
    expect(readWorkflow('ci.yml')).toContain(`node-version: ${exact}`);
    expect(release.publish).toContain('registry-url: https://registry.npmjs.org');
  });

  it('uses no pnpm cache in any release job', () => {
    expect(code(readWorkflow('release.yml'))).not.toMatch(/cache:/);
  });

  it('takes the expectations from plan and the hashes from pack, as job outputs', () => {
    expect(release.plan).toMatch(/expected: \$\{\{ steps\.plan\.outputs\.expected \}\}/);
    expect(release.pack).toMatch(/hashes: \$\{\{ steps\.pack\.outputs\.hashes \}\}/);
    expect(release.publish).toContain('needs.plan.outputs.expected');
    expect(release.publish).toContain('needs.pack.outputs.hashes');
  });

  it('installs with --ignore-scripts in every release job', () => {
    const installs = [...code(readWorkflow('release.yml')).matchAll(/run: pnpm install.*/g)];
    expect(installs.length).toBeGreaterThan(0);
    for (const m of installs) expect(m[0]).toContain('--ignore-scripts');
    expect(code(readWorkflow('ci.yml'))).toMatch(
      /publish-check:[\s\S]*pnpm install .*--ignore-scripts/,
    );
  });

  it('runs the changesets action without a publish input', () => {
    expect(release.version).toContain('changesets/action@');
    expect(release.version).not.toMatch(/publish:/);
    expect(release.version).not.toMatch(/id-token|NPM_TOKEN/);
  });

  it('tags with contents: write and without id-token', () => {
    expect(release.tag).toMatch(/contents: write/);
    expect(release.tag).not.toMatch(/id-token|NPM_TOKEN/);
  });

  it('keeps the dry-run publish check in ci.yml on Node 24', () => {
    const text = readWorkflow('ci.yml');
    expect(text).toContain('publish-check:');
    expect(text).toMatch(/--dry-run/);
    expect(text).toContain('release-plan.mjs pack release --tag ci-dry-run');
    expect(text).toMatch(/node-version: 24/);
  });

  it('keeps the changesets changelog on the GitHub generator', () => {
    const config = JSON.parse(fs.readFileSync(path.join(repo, '.changeset/config.json'), 'utf8'));
    expect(config.changelog).toEqual(['@changesets/changelog-github', { repo: 'mfeflow/mfeflow' }]);
  });
});

const setup = ({ views = [], npmVersion = '11.5.1' } = {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-job-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(path.join(dir, 'release'), { recursive: true });
  fs.mkdirSync(bin);
  const stub = (name, body) => {
    fs.writeFileSync(path.join(bin, name), `#!/bin/bash\n${body}\n`, { mode: 0o755 });
  };
  stub('sha256sum', 'shasum -a 256 "$@"');
  stub(
    'npm',
    `case "$1" in
--version) echo ${npmVersion} ;;
view) case " ${views.join(' ')} " in *" $2 "*) echo "\${2##*@}" ;; *) echo "npm error code E404" >&2; exit 1 ;; esac ;;
publish) echo "$@" >> "${dir}/published.txt" ;;
esac`,
  );
  return { dir, bin };
};

const makeTarball = (dir, file, manifest) => {
  const staging = fs.mkdtempSync(path.join(dir, 'pkg-'));
  fs.mkdirSync(path.join(staging, 'package'));
  fs.writeFileSync(path.join(staging, 'package/package.json'), JSON.stringify(manifest));
  spawnSync('tar', ['-czf', path.join(dir, 'release', file), '-C', staging, 'package']);
  return sha256(fs.readFileSync(path.join(dir, 'release', file)));
};

// Runs bash and tar for real; Windows runners start them slowly.
describe('the publish job shell', { timeout: 30_000 }, () => {
  const steps = code(readWorkflow('release.yml'))
    .split(/\n  tag:\n/)[0]
    .split(/\n  publish:\n/)[1]
    .split(/\n {6}- /);
  const runOf = (name) => {
    const step = steps.find((x) => x.includes(`name: ${name}`));
    const body = step.split('run: |\n')[1].split('\n');
    const block = [];
    for (const line of body) {
      if (line !== '' && !line.startsWith('          ')) break;
      block.push(line.slice(10));
    }
    return block.join('\n');
  };
  const verify = runOf('Verify the tarballs against the plan');
  const publish = runOf('Publish');

  const plan = [
    {
      name: '@mfeflow/core',
      version: '1.0.0',
      distTag: 'latest',
      tarball: 'mfeflow-core-1.0.0.tgz',
    },
    { name: 'mfeflow', version: '1.0.0', distTag: 'latest', tarball: 'mfeflow-1.0.0.tgz' },
  ];

  const runJob = ({ planned = plan, tweak, views, npmVersion } = {}) => {
    const { dir, bin } = setup({ views, npmVersion });
    const hashes = {};
    for (const e of plan)
      hashes[e.tarball] = makeTarball(dir, e.tarball, { name: e.name, version: e.version });
    tweak?.({ dir, hashes });
    const env = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      RUNNER_TEMP: dir,
      PLAN: JSON.stringify(planned),
      HASHES: JSON.stringify(hashes),
    };
    const exec = (script) => spawnSync('bash', ['-c', script], { cwd: dir, env, encoding: 'utf8' });
    const checked = exec(verify);
    const published = checked.status === 0 ? exec(publish) : undefined;
    const log = fs.existsSync(path.join(dir, 'published.txt'))
      ? fs.readFileSync(path.join(dir, 'published.txt'), 'utf8').trim().split('\n')
      : [];
    fs.rmSync(dir, { recursive: true, force: true });
    return { checked, published, log };
  };

  it('publishes the planned tarballs in plan order with provenance and the planned tag', () => {
    const { checked, published, log } = runJob();
    expect(checked.status).toBe(0);
    expect(published.status).toBe(0);
    expect(log).toEqual([
      'publish ./release/mfeflow-core-1.0.0.tgz --provenance --access public --ignore-scripts --tag latest',
      'publish ./release/mfeflow-1.0.0.tgz --provenance --access public --ignore-scripts --tag latest',
    ]);
  });

  it('skips a version that is already on npm', () => {
    const { log } = runJob({ views: ['@mfeflow/core@1.0.0'] });
    expect(log).toHaveLength(1);
    expect(log[0]).toContain('mfeflow-1.0.0.tgz');
  });

  it('refuses an npm older than 11.5.1', () => {
    const { checked, log } = runJob({ npmVersion: '11.4.0' });
    expect(checked.status).not.toBe(0);
    expect(checked.stdout).toContain('older than 11.5.1');
    expect(log).toEqual([]);
  });

  it('refuses a tarball whose bytes changed after the pack job hashed it', () => {
    const { checked, log } = runJob({
      tweak: ({ hashes }) => {
        hashes['mfeflow-1.0.0.tgz'] = '0'.repeat(64);
      },
    });
    expect(checked.status).not.toBe(0);
    expect(checked.stdout).toContain('does not match');
    expect(log).toEqual([]);
  });

  it('refuses a tarball that holds another package or version than planned', () => {
    for (const manifest of [
      { name: 'evil', version: '1.0.0' },
      { name: 'mfeflow', version: '9.9.9' },
    ]) {
      const { checked, log } = runJob({
        tweak: ({ dir, hashes }) => {
          hashes['mfeflow-1.0.0.tgz'] = makeTarball(dir, 'mfeflow-1.0.0.tgz', manifest);
        },
      });
      expect(checked.status).not.toBe(0);
      expect(log).toEqual([]);
    }
  });

  it('refuses a file in the artifact that is not in the plan or has a bad name', () => {
    for (const extra of ['other-1.0.0.tgz', 'Bad Name.tgz', 'script.sh']) {
      const { checked } = runJob({
        tweak: ({ dir }) => fs.writeFileSync(path.join(dir, 'release', extra), 'x'),
      });
      expect(checked.status).not.toBe(0);
    }
  });

  it('refuses a plan with a stable version on a pre channel or a prerelease on latest', () => {
    const stableOnNext = plan.map((e) => ({
      name: e.name,
      version: e.version,
      tarball: e.tarball,
      distTag: 'next',
    }));
    expect(runJob({ planned: stableOnNext }).checked.status).not.toBe(0);
  });

  it('refuses an empty plan', () => {
    expect(runJob({ planned: [] }).checked.status).not.toBe(0);
  });

  it('stops without publishing when npm view fails for a reason other than 404', () => {
    const { dir, bin } = setup();
    fs.writeFileSync(path.join(bin, 'npm'), '#!/bin/bash\necho "ETIMEDOUT" >&2\nexit 1\n', {
      mode: 0o755,
    });
    fs.writeFileSync(path.join(dir, 'verified.txt'), 'mfeflow 1.0.0 mfeflow-1.0.0.tgz latest\n');
    const result = spawnSync(
      'bash',
      ['-c', publish.replaceAll('$RUNNER_TEMP/verified.txt', `${dir}/verified.txt`)],
      {
        cwd: dir,
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, RUNNER_TEMP: dir },
        encoding: 'utf8',
      },
    );
    fs.rmSync(dir, { recursive: true, force: true });
    expect(result.status).not.toBe(0);
  });
});
