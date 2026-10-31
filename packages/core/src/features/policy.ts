import { TRANSFORM_OPS, type FeatureManifest } from '@mfeflow/contracts';
import { MfeflowError } from '../errors.js';

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

const LIFECYCLE_SCRIPTS = new Set([
  'preinstall',
  'install',
  'postinstall',
  'prepublish',
  'preprepare',
  'prepare',
  'postprepare',
  'prepublishOnly',
  'prepack',
  'postpack',
  'preuninstall',
  'uninstall',
  'postuninstall',
  'dependencies',
]);

/** Files that change how the package manager or git hooks run code. Third-party features cannot write them. */
const PROTECTED = [
  /(^|\/)package\.json$/,
  /(^|\/)mfeflow\.json$/,
  /(^|\/)pnpm-workspace\.yaml$/,
  /(^|\/)\.npmrc$/,
  /(^|\/)\.yarnrc(\.yml)?$/,
  /(^|\/)\.pnpmfile\.cjs$/,
  /(^|\/)lefthook[^/]*\.ya?ml$/,
  /(^|\/)\.lefthook[^/]*\.ya?ml$/,
  /(^|\/)\.husky\//,
  /(^|\/)\.git\//,
  /(^|\/)node_modules\//,
];

/** Registry version ranges and dist-tags only: no URLs, git, file, link, npm: aliases or `catalog:`. */
const SAFE_RANGE = /^[A-Za-z0-9.^~<>=*|+\- ]+$/;

export function isProtectedPath(file: string): boolean {
  return PROTECTED.some((pattern) => pattern.test(file));
}

/** Throws E203 for a script name npm would run on its own, or wraps another script. */
export function assertPlainScript(name: string, siblings: Iterable<string>, label: string): void {
  const known = new Set(siblings);
  const wraps = /^(pre|post)(.+)$/.exec(name)?.[2];
  if (LIFECYCLE_SCRIPTS.has(name) || (wraps !== undefined && known.has(wraps))) {
    throw new MfeflowError(
      'E203',
      `${label}: script "${name}" would run on its own (npm lifecycle)`,
    );
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
    if (isProtectedPath(file.to)) {
      throw new MfeflowError('E203', `${label}: "${file.to}" is a protected file`);
    }
  }
  for (const t of manifest.transforms ?? []) {
    if (isProtectedPath(t.file)) {
      throw new MfeflowError('E203', `${label}: "${t.file}" is a protected file`);
    }
  }
  for (const dep of manifest.dependencies ?? []) {
    if (!SAFE_RANGE.test(dep.range)) {
      throw new MfeflowError(
        'E203',
        `${label}: ${dep.name}@${dep.range} is not a registry version range`,
      );
    }
  }
  const names = (manifest.scripts ?? []).map((s) => s.name);
  for (const name of names) assertPlainScript(name, names, label);
}
