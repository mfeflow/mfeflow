// The logic behind .github/workflows/release.yml and the publish-check job in ci.yml. Pure functions
// are exported and unit-tested; the CLI at the bottom wires them to pnpm, npm and the workflow files.
// Needs only Node builtins, so the publish job can run it without installing anything.
//
//   node scripts/release-plan.mjs plan                       is there a version missing from npm?
//   node scripts/release-plan.mjs pack <dir>                 pnpm pack every public package, write the manifest
//   node scripts/release-plan.mjs verify <dir>               check hashes, prerelease policy and npm version
//   node scripts/release-plan.mjs publish <dir> [--dry-run] [--tag <t>]
//   node scripts/release-plan.mjs tags <dir>                 git tags for a release, one per line
//   node scripts/release-plan.mjs notes <version> <file>     one version's section of a changelog
//   node scripts/release-plan.mjs ci-version <version>       set every public package's version in place
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isMain, packAll, publicPackages } from './check-pack.mjs';

export const MANIFEST_FILE = 'release-manifest.json';
export const MIN_NPM = '11.5.1';

const FIRST = ['@mfeflow/contracts', '@mfeflow/core'];
const LAST = ['mfeflow', 'create-mfeflow'];

/** Position in the publish order among packages with no dependency between them. */
const rank = (name) => {
  if (FIRST.includes(name)) return FIRST.indexOf(name);
  if (LAST.includes(name)) return 1000 + LAST.indexOf(name);
  return 500;
};

/**
 * Publish order: a package after the public packages it depends on; contracts and core first among
 * those that are free, then the rest by name, then mfeflow and create-mfeflow.
 * `packages` is `[{ name, dependsOn: [name] }]`.
 */
export function publishOrder(packages) {
  const names = new Set(packages.map((p) => p.name));
  const waiting = new Map(
    packages.map((p) => [p.name, new Set(p.dependsOn.filter((d) => names.has(d) && d !== p.name))]),
  );
  const order = [];
  while (waiting.size > 0) {
    const ready = [...waiting].filter(([, deps]) => deps.size === 0).map(([name]) => name);
    if (ready.length === 0)
      throw new Error(`dependency cycle among ${[...waiting.keys()].join(', ')}`);
    const next = ready.toSorted((a, b) => rank(a) - rank(b) || a.localeCompare(b))[0];
    order.push(next);
    waiting.delete(next);
    for (const deps of waiting.values()) deps.delete(next);
  }
  return order;
}

/** Changeset files waiting to be versioned (every .md except the README). */
export function pendingChangesets(files) {
  return files.filter((f) => f.endsWith('.md') && f.toLowerCase() !== 'readme.md');
}

/** True when `npm view` failed because the package or version does not exist. */
export function isNotFound(output) {
  return /\bE404\b|404 Not Found|is not in this registry/i.test(output);
}

export const isPrerelease = (version) => /^\d+\.\d+\.\d+-/.test(version);

/** The pre-release channel of a version: `1.0.0-next.3` is `next`. */
export const prereleaseChannel = (version) => version.split('-')[1]?.split('.')[0] ?? null;

/** The dist-tag a version publishes under: `latest`, or the pre channel (`next`). */
export function distTagFor(version, preTag) {
  if (!isPrerelease(version)) return 'latest';
  if (!preTag) throw new Error(`${version} is a prerelease but no pre channel is active`);
  return preTag;
}

/** Problems that stop a manifest from being published. */
export function policyProblems(manifest) {
  const problems = [];
  const versions = new Set(manifest.packages.map((p) => p.version));
  if (versions.size !== 1)
    problems.push(`packages have different versions: ${[...versions].join(', ')}`);
  for (const p of manifest.packages) {
    if (!isPrerelease(p.version)) {
      if (manifest.distTag !== 'latest')
        problems.push(`${p.name}@${p.version} is stable but the dist-tag is "${manifest.distTag}"`);
    } else if (manifest.distTag === 'latest' || prereleaseChannel(p.version) !== manifest.distTag) {
      problems.push(
        `${p.name}@${p.version} is a prerelease and the active pre channel is "${manifest.distTag}"`,
      );
    }
  }
  return problems;
}

export function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/** Tarballs whose bytes do not match the manifest. `read(tarball)` returns the file's bytes. */
export function hashProblems(manifest, read) {
  return manifest.packages.flatMap((p) => {
    let actual;
    try {
      actual = sha256(read(p.tarball));
    } catch {
      return [`${p.tarball} is missing`];
    }
    return actual === p.sha256 ? [] : [`${p.tarball} sha256 is ${actual}, expected ${p.sha256}`];
  });
}

export function buildManifest({ packages, order, distTag, tarballs }) {
  const byName = new Map(packages.map((p) => [p.name, p]));
  return {
    distTag,
    packages: order.map((name) => {
      const pkg = byName.get(name);
      const tarball = tarballs.get(name);
      return { name, version: pkg.version, tarball: tarball.file, sha256: sha256(tarball.bytes) };
    }),
  };
}

/** The one version every package shares. */
export function sharedVersion(manifest) {
  const [first] = manifest.packages;
  if (!first || manifest.packages.some((p) => p.version !== first.version))
    throw new Error('the release has no single shared version');
  return first.version;
}

/** Git tags for a release: `name@version` per package, then `v<version>`. */
export function tagsFor(manifest) {
  return [...manifest.packages.map((p) => `${p.name}@${p.version}`), `v${sharedVersion(manifest)}`];
}

/** A version's section of a Changesets changelog, without its heading; null when there is none. */
export function changelogSection(changelog, version) {
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === `## ${version}`);
  if (start === -1) return null;
  const end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  const body = lines
    .slice(start + 1, end === -1 ? undefined : end)
    .join('\n')
    .trim();
  return body === '' ? null : body;
}

const parts = (v) => v.split('-')[0].split('.').map(Number);

/** `npm --version` output is at least `min` (npm trusted publishing needs 11.5.1). */
export function npmAtLeast(version, min = MIN_NPM) {
  const [a, b] = [parts(version.trim()), parts(min)];
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== b[i]) return (a[i] ?? 0) > b[i];
  }
  return true;
}

/** The file `pnpm pack` writes: `@scope/name` at 1.2.3 is `scope-name-1.2.3.tgz`. */
export const tarballName = ({ name, version }) =>
  `${name.replace(/^@/, '').replace('/', '-')}-${version}.tgz`;

export const ciVersion = (runId) => `0.0.0-ci.${runId}`;

/**
 * `run(command, args)` returns `{ status, stdout, stderr }`. A version is published when `npm view`
 * prints it; a 404 means it is not; any other failure is an error, never a guess.
 */
export function isPublished(name, version, run) {
  const result = run('npm', ['view', `${name}@${version}`, 'version']);
  if (result.status === 0) return result.stdout.trim() === version;
  if (isNotFound(`${result.stdout}${result.stderr}`)) return false;
  throw new Error(`npm view ${name}@${version} failed:\n${result.stdout}${result.stderr}`);
}

/** Publishes the manifest's tarballs in order, skipping versions already on npm. Returns what it did. */
export function publishAll(manifest, dir, run, { dryRun = false, tag } = {}) {
  const done = [];
  for (const p of manifest.packages) {
    if (!dryRun && isPublished(p.name, p.version, run)) {
      done.push({ name: p.name, version: p.version, action: 'skipped' });
      continue;
    }
    const args = [
      'publish',
      `./${path.posix.join(dir, p.tarball)}`,
      '--access',
      'public',
      '--ignore-scripts',
      '--tag',
      tag ?? manifest.distTag,
      ...(dryRun ? ['--dry-run'] : ['--provenance']),
    ];
    const result = run('npm', args);
    if (result.status !== 0)
      throw new Error(`npm ${args.join(' ')} failed:\n${result.stdout}${result.stderr}`);
    done.push({ name: p.name, version: p.version, action: dryRun ? 'dry-run' : 'published' });
  }
  return done;
}

/** Public packages whose current version is not on npm. */
export function unpublished(packages, run) {
  return packages.filter((p) => !isPublished(p.manifest.name, p.manifest.version, run));
}

function exec(command, args) {
  return spawnSync(command, args, { encoding: 'utf8', shell: process.platform === 'win32' });
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function preTagOf(repo) {
  const file = path.join(repo, '.changeset/pre.json');
  return fs.existsSync(file) && readJson(file).mode === 'pre' ? readJson(file).tag : undefined;
}

function setOutput(name, value) {
  console.log(`${name}=${value}`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

const dependsOn = (manifest) => [
  ...Object.keys(manifest.dependencies ?? {}),
  ...Object.keys(manifest.optionalDependencies ?? {}),
];

function cmdPlan(repo) {
  const pending = pendingChangesets(fs.readdirSync(path.join(repo, '.changeset')));
  if (pending.length > 0) {
    console.log(`${pending.length} changeset(s) pending: the version pull request comes first.`);
    return setOutput('release', 'false');
  }
  const missing = unpublished(publicPackages(repo), exec);
  for (const p of missing) console.log(`not on npm: ${p.manifest.name}@${p.manifest.version}`);
  setOutput('release', missing.length > 0 ? 'true' : 'false');
}

function cmdPack(repo, outDir) {
  const packages = publicPackages(repo);
  const versions = packages.map((p) => ({ name: p.manifest.name, version: p.manifest.version }));
  const preTag = preTagOf(repo);
  const distTag = distTagFor(versions[0].version, preTag);
  fs.rmSync(outDir, { recursive: true, force: true });
  const files = packAll(packages, outDir, repo);
  const tarballs = new Map();
  for (const file of files) {
    const name = packages.find((p) => tarballName(p.manifest) === path.basename(file))?.manifest
      .name;
    if (name) tarballs.set(name, { file: path.basename(file), bytes: fs.readFileSync(file) });
  }
  const order = publishOrder(
    packages.map((p) => ({ name: p.manifest.name, dependsOn: dependsOn(p.manifest) })),
  );
  for (const name of order)
    if (!tarballs.has(name)) throw new Error(`no tarball packed for ${name}`);
  const manifest = buildManifest({ packages: versions, order, distTag, tarballs });
  const problems = policyProblems(manifest);
  if (problems.length > 0) throw new Error(problems.join('\n'));
  fs.writeFileSync(path.join(outDir, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `packed ${order.length} packages at ${sharedVersion(manifest)} (dist-tag ${distTag})`,
  );
}

function loadManifest(dir) {
  return readJson(path.join(dir, MANIFEST_FILE));
}

function cmdVerify(dir) {
  const manifest = loadManifest(dir);
  const npm = exec('npm', ['--version']).stdout.trim();
  const problems = [
    ...(npmAtLeast(npm)
      ? []
      : [`npm ${npm} is older than ${MIN_NPM}, which trusted publishing needs`]),
    ...policyProblems(manifest),
    ...hashProblems(manifest, (f) => fs.readFileSync(path.join(dir, f))),
  ];
  if (problems.length > 0) throw new Error(problems.join('\n'));
  console.log(`verified ${manifest.packages.length} tarballs, npm ${npm}`);
}

function cmdPublish(dir, flags) {
  const manifest = loadManifest(dir);
  const tagIndex = flags.indexOf('--tag');
  const done = publishAll(
    manifest,
    dir,
    (command, args) => {
      const result = exec(command, args);
      process.stdout.write(result.stdout ?? '');
      process.stderr.write(result.stderr ?? '');
      return result;
    },
    { dryRun: flags.includes('--dry-run'), tag: tagIndex === -1 ? undefined : flags[tagIndex + 1] },
  );
  for (const d of done) console.log(`${d.action} ${d.name}@${d.version}`);
}

function cmdCiVersion(repo, version) {
  for (const { dir } of publicPackages(repo)) {
    const file = path.join(dir, 'package.json');
    fs.writeFileSync(file, `${JSON.stringify({ ...readJson(file), version }, null, 2)}\n`);
  }
}

function main(argv) {
  const repo = path.resolve(import.meta.dirname, '..');
  const [command, ...rest] = argv;
  switch (command) {
    case 'plan':
      return cmdPlan(repo);
    case 'pack':
      return cmdPack(repo, path.resolve(rest[0]));
    case 'verify':
      return cmdVerify(rest[0]);
    case 'publish':
      return cmdPublish(rest[0], rest.slice(1));
    case 'tags':
      return console.log(tagsFor(loadManifest(rest[0])).join('\n'));
    case 'notes': {
      const section = changelogSection(fs.readFileSync(rest[1], 'utf8'), rest[0]);
      return console.log(section ?? `See packages/cli/CHANGELOG.md for ${rest[0]}.`);
    }
    case 'ci-version':
      return cmdCiVersion(repo, rest[0]);
    default:
      throw new Error(`unknown command "${command ?? ''}"`);
  }
}

if (isMain(process.argv[1], import.meta.filename)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
