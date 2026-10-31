import { TRANSFORM_OPS, type FeatureManifest } from '@mfeflow/contracts';
import { MfeflowError } from '../errors.js';
import { envKeyFiles } from '../transforms/add-env-key.js';
import { assertThirdPartyPath } from './write-policy.js';

/** Where a feature came from decides what it may do. */
export type Trust = 'first-party' | 'third-party';

/** Fields a feature from a namespaced registry may have. Everything else is an E203. */
export const THIRD_PARTY_KEYS: ReadonlySet<string> = new Set([
  '$schema',
  'name',
  'version',
  'description',
  'prompts',
  'requires',
  'conflicts',
  'files',
  'dependencies',
  'scripts',
  'transforms',
]);

/** Shape of a third-party script name: lower-case words, optionally namespaced with colons. */
const SCRIPT_NAME = /^[a-z][a-z0-9-]*(:[a-z0-9-]+)*$/;

/** Prefixes the package managers read as hooks of their own (`pnpm:devPreinstall`). */
const MANAGER_PREFIXES = new Set(['pnpm', 'npm', 'yarn', 'bun']);

/** Every event npm or pnpm runs a script for without being asked by name, plus the ones they wrap. */
const LIFECYCLE_SCRIPTS = new Set([
  'install',
  'uninstall',
  'prepare',
  'prepublish',
  'prepublishonly',
  'publish',
  'pack',
  'version',
  'shrinkwrap',
  'dependencies',
  'test',
  'start',
  'stop',
  'restart',
]);

/** Registry version ranges and dist-tags only: no URLs, git, file, link, npm: aliases or `catalog:`. */
const SAFE_RANGE = /^[A-Za-z0-9.^~<>=*|+\- ]+$/;

/**
 * Throws E203 unless `name` is a plain, namespaced script name that no package
 * manager runs on its own. An allowlist on the shape, then the known hooks:
 * lifecycle events, `pnpm:`/`npm:`/`yarn:`/`bun:` prefixes and every `pre` or
 * `post` name, since what it wraps may be added to package.json later.
 */
export function assertPlainScript(name: string, label: string): void {
  const reject = (why: string): never => {
    throw new MfeflowError('E203', `${label}: script "${name}" ${why}`);
  };
  if (!SCRIPT_NAME.test(name)) {
    reject('must be lower-case words joined by ":" (for example analytics:check)');
  }
  const prefix = name.split(':')[0] ?? '';
  if (MANAGER_PREFIXES.has(prefix)) reject('uses a package manager hook prefix');
  if (LIFECYCLE_SCRIPTS.has(name)) reject('would run on its own (npm lifecycle)');
  if (/^(pre|post)/.test(name)) {
    reject('starts with pre or post, which wraps another script; namespace it, e.g. feature:name');
  }
}

/** Keys check: runs on the raw JSON, before the schema, so "hooks" is named rather than ignored. */
export function assertAllowedKeys(value: Record<string, unknown>, label: string): void {
  for (const key of Object.keys(value)) {
    if (!THIRD_PARTY_KEYS.has(key)) {
      throw new MfeflowError('E203', `${label}: "${key}" is not allowed in a third-party feature`);
    }
  }
}

/** Unknown op names are their own error, so authors learn what the built-ins are. */
export function assertKnownOps(value: Record<string, unknown>, label: string): void {
  const transforms = value.transforms;
  if (!Array.isArray(transforms)) return;
  transforms.forEach((t: unknown, i) => {
    const op: unknown = typeof t === 'object' && t !== null ? Reflect.get(t, 'op') : undefined;
    if (typeof op === 'string' && !TRANSFORM_OPS.some((name) => name === op)) {
      throw new MfeflowError('E204', `${label}: transforms[${String(i)}] uses "${op}"`);
    }
  });
}

/** What a validated third-party manifest may not contain. */
export function assertThirdPartyContent(manifest: FeatureManifest, label: string): void {
  if (manifest.name.startsWith('@mfeflow/') || !manifest.name.startsWith('@')) {
    throw new MfeflowError(
      'E203',
      `${label}: third-party features must be namespaced and cannot use @mfeflow`,
    );
  }
  for (const file of manifest.files ?? []) {
    if (file.from !== undefined) {
      throw new MfeflowError(
        'E203',
        `${label}: "${file.to}" reads a local file (from); use inline content`,
      );
    }
    assertThirdPartyPath(file.to, file.to);
  }
  for (const t of manifest.transforms ?? []) {
    const files = t.op === 'add-env-key' ? envKeyFiles(t) : [t.file];
    for (const file of files) assertThirdPartyPath(file, file);
  }
  for (const dep of manifest.dependencies ?? []) {
    if (!SAFE_RANGE.test(dep.range)) {
      throw new MfeflowError(
        'E203',
        `${label}: ${dep.name}@${dep.range} is not a registry version range`,
      );
    }
  }
  for (const script of manifest.scripts ?? []) assertPlainScript(script.name, label);
}
