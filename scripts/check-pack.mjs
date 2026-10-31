// Packs every public package and checks the tarball the way npm will publish it: README, LICENSE and
// package.json present; every file `exports`, `bin` and `types` point at is inside; no sources, tests,
// fixtures or build caches; no `workspace:` or `catalog:` spec left; the CLI ships its templates and
// features; the size is sane. Needs `pnpm build` to have run.
// Usage: node scripts/check-pack.mjs   (pnpm check:pack)
// Public packages are every packages/* folder whose package.json is not `private`, so a new package is
// checked without editing this file.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const MAX_TARBALL_BYTES = 5 * 1024 * 1024;
export const MAX_UNPACKED_BYTES = 25 * 1024 * 1024;

const DEP_FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies', 'devDependencies'];
const UNPUBLISHED_SPEC = /^(workspace|catalog|link|file):/;
const FORBIDDEN = [
  { name: 'tests', test: (f) => /\.(test|spec)\.(d\.)?[cm]?[jt]sx?(\.map)?$/.test(f) },
  { name: '__fixture__', test: (f) => f.split('/').includes('__fixture__') },
  { name: '.turbo', test: (f) => f.split('/').includes('.turbo') },
  { name: 'coverage', test: (f) => f.split('/').includes('coverage') },
  { name: 'tsbuildinfo', test: (f) => f.endsWith('.tsbuildinfo') },
];
/** The CLI's assets are project templates, which have their own `src/` folders. */
const isSource = (f) => !f.startsWith('assets/') && f.split('/').includes('src');

function entryPaths(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (value && typeof value === 'object')
    for (const v of Object.values(value)) entryPaths(v, out);
  return out;
}

/** Files the manifest promises: `exports`, `bin`, `types`, `main`, `module`. */
export function referencedFiles(manifest) {
  const refs = [
    ...entryPaths(manifest.exports),
    ...entryPaths(manifest.bin),
    ...entryPaths(manifest.types),
    ...entryPaths(manifest.main),
    ...entryPaths(manifest.module),
  ];
  return [...new Set(refs.filter((r) => r.startsWith('./') && !r.includes('*')))].map((r) =>
    path.posix.normalize(r.slice(2)),
  );
}

/** Problems with one packed package, as readable strings. Empty means it is fine. */
export function validatePack({ manifest, files, tarballBytes, unpackedBytes, assetFolders = [] }) {
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

function checkPackage(repo, { dir, manifest }, work) {
  const dest = path.join(work, manifest.name.replace(/[@/]/g, '_'));
  fs.mkdirSync(path.join(dest, 'out'), { recursive: true });
  run('pnpm', ['pack', '--pack-destination', path.join(dest, 'out')], dir);
  const tarball = fs.readdirSync(path.join(dest, 'out')).find((f) => f.endsWith('.tgz'));
  if (!tarball) throw new Error('pnpm pack produced no tarball');
  const tarballPath = path.join(dest, 'out', tarball);
  const unpacked = path.join(dest, 'unpacked');
  fs.mkdirSync(unpacked);
  run('tar', ['-xzf', tarballPath, '-C', unpacked], dest);
  const root = path.join(unpacked, 'package');
  const files = walk(root);
  const packed = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const unpackedBytes = files.reduce((sum, f) => sum + fs.statSync(path.join(root, f)).size, 0);
  const problems = validatePack({
    manifest: packed,
    files,
    tarballBytes: fs.statSync(tarballPath).size,
    unpackedBytes,
    assetFolders: ['features', 'templates'].map((kind) => ({
      kind,
      entries: folderEntries(repo, kind),
    })),
  });
  return {
    name: manifest.name,
    version: packed.version,
    tarballBytes: fs.statSync(tarballPath).size,
    unpackedBytes,
    fileCount: files.length,
    problems,
  };
}

function main() {
  const repo = path.resolve(import.meta.dirname, '..');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mfeflow-pack-'));
  const results = [];
  try {
    for (const pkg of publicPackages(repo)) results.push(checkPackage(repo, pkg, work));
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  const width = Math.max(...results.map((r) => r.name.length));
  for (const r of results) {
    const status = r.problems.length === 0 ? 'ok  ' : 'FAIL';
    console.log(
      `${status} ${r.name.padEnd(width)}  ${r.version}  ${String(r.fileCount).padStart(4)} files  tarball ${formatBytes(r.tarballBytes).padStart(9)}  unpacked ${formatBytes(r.unpackedBytes).padStart(9)}`,
    );
    for (const p of r.problems) console.log(`       - ${p}`);
  }
  const failed = results.filter((r) => r.problems.length > 0);
  console.log(`\n${results.length - failed.length}/${results.length} packages ok`);
  if (failed.length > 0) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) main();
