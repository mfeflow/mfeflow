// Packs every public package and checks the tarball the way npm will publish it: README, LICENSE and
// package.json present; every file `exports`, `bin`, `main` and `types` point at is inside; no sources,
// tests, fixtures or build caches; no `workspace:` or `catalog:` spec left; every package the published
// code imports is a declared dependency or peer; every public package is in the changesets `fixed`
// group; the CLI ships its templates and features; the size is sane. Needs `pnpm build` to have run.
// Usage: node scripts/check-pack.mjs   (pnpm check:pack)
// Public packages are every packages/* folder whose package.json is not `private`, so a new package is
// checked without editing this file.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { builtinModules } from 'node:module';
import os from 'node:os';
import path from 'node:path';

export const MAX_TARBALL_BYTES = 5 * 1024 * 1024;
export const MAX_UNPACKED_BYTES = 25 * 1024 * 1024;

const DEP_FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies', 'devDependencies'];
const UNPUBLISHED_SPEC = /^(workspace|catalog|link|file):/;
const segments = (f) => f.split('/');
/** The CLI's assets are project templates: they have their own `src/` folders, tests and fixtures. */
const inAssets = (f) => f.startsWith('assets/');
const hasSegment = (f, names) => segments(f).some((s) => names.includes(s));
const FORBIDDEN = [
  {
    name: 'tests',
    test: (f) =>
      !inAssets(f) &&
      (/\.(test|spec)\.(d\.)?[cm]?[jt]sx?(\.map)?$/.test(f) ||
        hasSegment(f, ['test', 'tests', '__tests__'])),
  },
  {
    name: 'fixtures',
    test: (f) => !inAssets(f) && hasSegment(f, ['fixtures', '__fixture__']),
  },
  { name: '.turbo', test: (f) => hasSegment(f, ['.turbo']) },
  { name: 'coverage', test: (f) => hasSegment(f, ['coverage']) },
  { name: 'tsbuildinfo', test: (f) => f.endsWith('.tsbuildinfo') },
];
const isSource = (f) => !inAssets(f) && hasSegment(f, ['src']);

function entryPaths(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (value && typeof value === 'object')
    for (const v of Object.values(value)) entryPaths(v, out);
  return out;
}

/** Files the manifest promises: `exports`, `bin`, `types`, `main`, `module`, with or without `./`. */
export function referencedFiles(manifest) {
  const refs = [
    ...entryPaths(manifest.exports),
    ...entryPaths(manifest.bin),
    ...entryPaths(manifest.types),
    ...entryPaths(manifest.main),
    ...entryPaths(manifest.module),
  ];
  return [
    ...new Set(
      refs.filter((r) => !r.includes('*')).map((r) => path.posix.normalize(r.replace(/^\.\//, ''))),
    ),
  ];
}

const BUILTINS = new Set(builtinModules);
const SCANNED = /\.(?:[cm]?js|d\.[cm]?ts)$/;
const IMPORT_PATTERNS = [
  /(?:^|(?<=;))[ \t]*(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/gm,
  /(?:^|(?<=;))[ \t]*import\s*['"]([^'"]+)['"]/gm,
  /(?<![\w$.'"-])(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

const packageOf = (specifier) =>
  specifier
    .split('/')
    .slice(0, specifier.startsWith('@') ? 2 : 1)
    .join('/');

/** The packages a built file imports, in order of appearance; relative paths and node builtins are left out. */
export function bareImports(source) {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const found = [];
  for (const pattern of IMPORT_PATTERNS)
    for (const match of code.matchAll(pattern)) found.push({ at: match.index, spec: match[1] });
  return found
    .sort((a, b) => a.at - b.at)
    .map(({ spec }) => spec)
    .filter((spec) => !spec.startsWith('.') && !spec.startsWith('/') && !spec.startsWith('node:'))
    .filter((spec) => !BUILTINS.has(spec.split('/')[0]))
    .map(packageOf);
}

/** Imports in `contents` (file to text) of a package that its manifest does not declare to consumers. */
export function undeclaredImports(manifest, contents) {
  const declared = new Set([
    manifest.name,
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ]);
  const problems = [];
  for (const [file, text] of Object.entries(contents)) {
    if (inAssets(file) || !SCANNED.test(file)) continue;
    for (const name of new Set(bareImports(text)))
      if (!declared.has(name))
        problems.push(`${file} imports "${name}", which is not a dependency or peerDependency`);
  }
  return problems;
}

/** Public packages missing from the changesets `fixed` group, or both grouped and ignored. */
export function fixedGroupProblems(config, publicNames) {
  const grouped = new Set((config.fixed ?? []).flat());
  const ignored = new Set(config.ignore ?? []);
  return [
    ...publicNames
      .filter((n) => !grouped.has(n))
      .map((n) => `${n} is not in the "fixed" group of .changeset/config.json`),
    ...[...grouped]
      .filter((n) => ignored.has(n))
      .map((n) => `${n} is both in "fixed" and in "ignore" of .changeset/config.json`),
  ];
}

/** True when `argv1` (as Node was started) and `file` are the same file, even through symlinks. */
export function isMain(argv1, file) {
  if (!argv1) return false;
  try {
    return fs.realpathSync(argv1) === fs.realpathSync(file);
  } catch {
    return false;
  }
}

/** Problems with one packed package, as readable strings. Empty means it is fine. */
export function validatePack({
  manifest,
  files,
  tarballBytes,
  unpackedBytes,
  assetFolders = [],
  contents = {},
}) {
  const problems = [];
  const has = new Set(files);
  const topLevel = (name) =>
    files.some((f) => !f.includes('/') && f.toLowerCase().replace(/\.[^.]*$/, '') === name);

  if (!has.has('package.json')) problems.push('package.json is missing');
  if (!topLevel('readme')) problems.push('README is missing');
  if (!topLevel('license')) problems.push('LICENSE is missing');

  for (const ref of referencedFiles(manifest)) {
    if (!has.has(ref)) problems.push(`${ref} is referenced by package.json but not in the tarball`);
  }

  for (const f of files) {
    if (isSource(f)) problems.push(`${f}: sources must not be published`);
    for (const rule of FORBIDDEN)
      if (rule.test(f)) problems.push(`${f}: ${rule.name} must not be published`);
  }

  for (const field of DEP_FIELDS) {
    for (const [name, spec] of Object.entries(manifest[field] ?? {})) {
      if (UNPUBLISHED_SPEC.test(spec)) problems.push(`${field}.${name} is still "${spec}"`);
    }
  }

  problems.push(...undeclaredImports(manifest, contents));

  if (manifest.name === 'mfeflow') {
    for (const folder of assetFolders) {
      const kind = folder.kind;
      if (!files.some((f) => f.startsWith(`assets/${kind}/`))) {
        problems.push(`assets/${kind}/ is empty or missing`);
        continue;
      }
      for (const entry of folder.entries) {
        if (!files.some((f) => f.startsWith(`assets/${kind}/${entry}/`)))
          problems.push(`assets/${kind}/${entry}/ is missing`);
      }
    }
  }

  if (tarballBytes > MAX_TARBALL_BYTES)
    problems.push(
      `tarball is ${formatBytes(tarballBytes)}, over the ${formatBytes(MAX_TARBALL_BYTES)} limit`,
    );
  if (unpackedBytes > MAX_UNPACKED_BYTES)
    problems.push(
      `unpacked size is ${formatBytes(unpackedBytes)}, over the ${formatBytes(MAX_UNPACKED_BYTES)} limit`,
    );
  return problems;
}

export function formatBytes(n) {
  return n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function publicPackages(repo) {
  const base = path.join(repo, 'packages');
  return fs
    .readdirSync(base)
    .map((dir) => path.join(base, dir))
    .filter((dir) => fs.existsSync(path.join(dir, 'package.json')))
    .map((dir) => ({
      dir,
      manifest: JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')),
    }))
    .filter(({ manifest }) => manifest.private !== true);
}

function walk(root, rel = '') {
  return fs.readdirSync(path.join(root, rel), { withFileTypes: true }).flatMap((e) => {
    const next = path.posix.join(rel, e.name);
    return e.isDirectory() ? walk(root, next) : [next];
  });
}

function folderEntries(repo, folder) {
  return fs
    .readdirSync(path.join(repo, folder), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0)
    throw new Error(`${command} ${args.join(' ')} failed:\n${result.stdout}${result.stderr}`);
  return result.stdout;
}

/** Packs every package with one pnpm call and returns each tarball's path by package name. */
function packAll(packages, out, cwd) {
  fs.mkdirSync(out, { recursive: true });
  run(
    'pnpm',
    [
      '-r',
      ...packages.flatMap((p) => ['--filter', p.manifest.name]),
      'pack',
      '--pack-destination',
      out,
    ],
    cwd,
  );
  return fs
    .readdirSync(out)
    .filter((f) => f.endsWith('.tgz'))
    .map((f) => path.join(out, f));
}

function inspectTarball(repo, tarballPath, work) {
  const unpacked = fs.mkdtempSync(path.join(work, 'unpacked-'));
  run('tar', ['-xzf', tarballPath, '-C', unpacked], work);
  const root = path.join(unpacked, 'package');
  const files = walk(root);
  const packed = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const unpackedBytes = files.reduce((sum, f) => sum + fs.statSync(path.join(root, f)).size, 0);
  const contents = Object.fromEntries(
    files
      .filter((f) => !inAssets(f) && SCANNED.test(f))
      .map((f) => [f, fs.readFileSync(path.join(root, f), 'utf8')]),
  );
  const tarballBytes = fs.statSync(tarballPath).size;
  const problems = validatePack({
    manifest: packed,
    files,
    tarballBytes,
    unpackedBytes,
    contents,
    assetFolders: ['features', 'templates'].map((kind) => ({
      kind,
      entries: folderEntries(repo, kind),
    })),
  });
  return {
    name: packed.name,
    version: packed.version,
    tarballBytes,
    unpackedBytes,
    fileCount: files.length,
    problems,
  };
}

function main() {
  const repo = path.resolve(import.meta.dirname, '..');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mfeflow-pack-'));
  const packages = publicPackages(repo);
  const results = [];
  try {
    const tarballs = packAll(packages, path.join(work, 'out'), repo);
    for (const tarball of tarballs) results.push(inspectTarball(repo, tarball, work));
    for (const { manifest } of packages)
      if (!results.some((r) => r.name === manifest.name))
        results.push({
          name: manifest.name,
          version: manifest.version,
          tarballBytes: 0,
          unpackedBytes: 0,
          fileCount: 0,
          problems: ['pnpm pack produced no tarball'],
        });
    const config = JSON.parse(fs.readFileSync(path.join(repo, '.changeset/config.json'), 'utf8'));
    const grouping = fixedGroupProblems(
      config,
      packages.map((p) => p.manifest.name),
    );
    results.sort((a, b) => a.name.localeCompare(b.name));
    report(results, grouping);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

function report(results, grouping) {
  const width = Math.max(...results.map((r) => r.name.length));
  for (const r of results) {
    const status = r.problems.length === 0 ? 'ok  ' : 'FAIL';
    console.log(
      `${status} ${r.name.padEnd(width)}  ${r.version}  ${String(r.fileCount).padStart(4)} files  tarball ${formatBytes(r.tarballBytes).padStart(9)}  unpacked ${formatBytes(r.unpackedBytes).padStart(9)}`,
    );
    for (const p of r.problems) console.log(`       - ${p}`);
  }
  for (const p of grouping) console.log(`FAIL ${p}`);
  const failed = results.filter((r) => r.problems.length > 0);
  console.log(`\n${results.length - failed.length}/${results.length} packages ok`);
  if (failed.length > 0 || grouping.length > 0) process.exitCode = 1;
}

if (isMain(process.argv[1], import.meta.filename)) main();
