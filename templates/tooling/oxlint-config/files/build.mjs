/* oxlint-disable -- a plain script: the root tsconfig loads no Node types, so the type-aware rules cannot read it */
// Writes dist/oxlintrc.json: the rules of @mfeflow/oxlint-config with overrides.json on top.
// oxlint does not look up a package name in "extends", so the rules are copied in here
// instead of being extended, and the published package does not depend on where it is installed.
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

const base = readJson(require.resolve('@mfeflow/oxlint-config/oxlintrc.json'));
const own = readJson(new URL('overrides.json', import.meta.url));

const merged = { ...base };
for (const [key, value] of Object.entries(own)) {
  const was = base[key];
  if (Array.isArray(value) && Array.isArray(was)) {
    const seen = new Set(was.map((item) => JSON.stringify(item)));
    merged[key] = [...was, ...value.filter((item) => !seen.has(JSON.stringify(item)))];
  } else if (isObject(value) && isObject(was)) {
    merged[key] = { ...was, ...value };
  } else {
    merged[key] = value;
  }
}

fs.mkdirSync(new URL('dist/', import.meta.url), { recursive: true });
fs.writeFileSync(
  new URL('dist/oxlintrc.json', import.meta.url),
  `${JSON.stringify(merged, null, 2)}\n`,
);
