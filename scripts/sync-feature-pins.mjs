// Keeps the exact versions that features and templates install (`"range"` in each feature.json) in
// step with the repo's own catalog in pnpm-workspace.yaml. Dependabot bumps the catalog only, so
// without this a generated project falls behind, and a `--local` project ends up with two copies of
// a bundler (TypeScript then compares their types and fails).
// Usage: node scripts/sync-feature-pins.mjs           rewrite the pins and bump each changed feature
//        node scripts/sync-feature-pins.mjs --check   list the drift and exit 1, write nothing
import fs from 'node:fs';
import path from 'node:path';

const EXACT = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** `name -> version` from the top-level `catalog:` block of pnpm-workspace.yaml. */
export function readCatalog(yamlText) {
  const catalog = new Map();
  let inside = false;
  for (const line of yamlText.split(/\r?\n/)) {
    if (/^catalog:\s*$/.test(line)) {
      inside = true;
      continue;
    }
    if (!inside) continue;
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    if (!line.startsWith(' ')) break;
    const entry = /^\s+(['"]?)([^'":\s]+)\1:\s*(['"]?)([^'"\s#]+)\3/.exec(line);
    if (entry) catalog.set(entry[2], entry[4]);
  }
  return catalog;
}

/** Every `{ name, range }` pair in a parsed feature.json whose exact range differs from the catalog. */
export function driftIn(manifest, catalog) {
  const drift = [];
  const walk = (node) => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    if (node === null || typeof node !== 'object') return;
    const wanted = catalog.get(node.name);
    if (
      typeof node.range === 'string' &&
      wanted &&
      EXACT.test(node.range) &&
      node.range !== wanted
    ) {
      drift.push({ name: node.name, from: node.range, to: wanted });
    }
    for (const child of Object.values(node)) walk(child);
  };
  walk(manifest);
  return drift;
}

const escape = (s) => s.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

export function bumpPatch(version) {
  const parts = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!parts) throw new Error(`cannot bump "${version}": not a plain x.y.z version`);
  return `${parts[1]}.${parts[2]}.${Number(parts[3]) + 1}`;
}

/** The manifest text with the drifted pins replaced and its own version bumped once. Formatting is kept. */
export function rewrite(text, drift) {
  let out = text;
  for (const { name, from, to } of drift) {
    const pin = new RegExp(`("name":\\s*"${escape(name)}",\\s*"range":\\s*")${escape(from)}"`, 'g');
    const next = out.replace(pin, `$1${to}"`);
    if (next === out) {
      throw new Error(
        `cannot rewrite ${name} ${from} in place: write "range" right after "name" in that entry`,
      );
    }
    out = next;
  }
  const version = JSON.parse(text).version;
  return out.replace(`"version": "${version}"`, `"version": "${bumpPatch(version)}"`);
}

export function manifests(repo) {
  const found = [];
  for (const root of ['features', 'templates']) {
    const dir = path.join(repo, root);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir).toSorted()) {
      const file = path.join(dir, name, 'feature.json');
      if (fs.existsSync(file)) found.push(file);
    }
  }
  return found;
}

export function main(argv = process.argv.slice(2), repo = process.cwd(), log = console) {
  const check = argv.includes('--check');
  const catalog = readCatalog(fs.readFileSync(path.join(repo, 'pnpm-workspace.yaml'), 'utf8'));
  let drifted = 0;
  for (const file of manifests(repo)) {
    const text = fs.readFileSync(file, 'utf8');
    const drift = driftIn(JSON.parse(text), catalog);
    if (drift.length === 0) continue;
    drifted += 1;
    const rel = path.relative(repo, file).replaceAll('\\', '/');
    for (const d of drift) log.log(`${rel}: ${d.name} ${d.from} -> ${d.to}`);
    if (!check) fs.writeFileSync(file, rewrite(text, drift));
  }
  if (drifted === 0) {
    log.log('Feature pins match the catalog.');
    return 0;
  }
  if (check) {
    log.error(
      `${String(drifted)} feature.json file(s) pin versions the catalog no longer has. Run: node scripts/sync-feature-pins.mjs`,
    );
    return 1;
  }
  log.log(`Updated ${String(drifted)} feature.json file(s) and bumped their versions.`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  process.exitCode = main();
}
