import { MfeflowError } from '../errors.js';

/**
 * The form every path rule is checked on. macOS and Windows treat `.GIT`,
 * `.git.` and a decomposed `é` as the same file as their plain spellings, so
 * rules must never run on the raw text.
 */
export function policyKey(file: string): string {
  return file.normalize('NFC').toLowerCase().normalize('NFC');
}

const PROTECTED = [
  /(^|\/)package\.json$/,
  /(^|\/)mfeflow\.json$/,
  /(^|\/)pnpm-workspace\.yaml$/,
  /(^|\/)\.npmrc$/,
  /(^|\/)\.yarnrc(\.[^/]*)?$/,
  /(^|\/)\.pnpmfile\.[^/]*$/,
  /(^|\/)(pnpm-lock\.yaml|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|bun\.lockb?)$/,
  /(^|\/)bunfig\.toml$/,
  /(^|\/)\.?lefthook[^/]*$/,
  /(^|\/)\.simple-git-hooks[^/]*$/,
  /(^|\/)\.pre-commit-config\.ya?ml$/,
  /(^|\/)\.(husky|yarn|git)(\/|$)/,
  /(^|\/)node_modules(\/|$)/,
];

/** Files that change how the package manager or git hooks run code. Third-party features cannot write them. */
export function isProtectedPath(file: string): boolean {
  const key = policyKey(file);
  return PROTECTED.some((pattern) => pattern.test(key));
}

const DEVICE_NAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  ...Array.from({ length: 9 }, (_, i) => [`com${String(i + 1)}`, `lpt${String(i + 1)}`]).flat(),
  'com¹',
  'com²',
  'com³',
  'lpt¹',
  'lpt²',
  'lpt³',
]);

/** Control, format (zero-width, bidi) and unassigned characters: invisible in a diff, ignored by some file systems. */
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Cn}\p{Co}\p{Cs}]/u;

function refuse(file: string, why: string): never {
  throw new MfeflowError('E105', `"${file}" ${why}`);
}

/**
 * Rules for every feature, first-party or not. Runs on the folded path, with
 * rejection (never stripping) of anything a file system could read as a
 * different name.
 */
export function assertWritable(file: string): void {
  if (INVISIBLE.test(file)) refuse(file, 'has control or invisible characters');
  const key = policyKey(file);
  if (key === 'mfeflow.json') refuse(file, 'is not a place features write to');
  for (const segment of key.split('/')) {
    if (segment === '.git' || segment === 'node_modules') {
      refuse(file, 'is not a place features write to');
    }
    if (segment.includes(':')) refuse(file, 'has a ":" (a Windows stream)');
    if (/[. ]$/.test(segment)) refuse(file, 'has a name ending in a dot or space');
    const base = (segment.split('.')[0] ?? '').trimEnd();
    if (DEVICE_NAMES.has(base)) refuse(file, 'is a Windows device name');
  }
}
