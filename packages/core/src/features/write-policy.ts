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

/** The only top-level folders (inside the target app or the root) a third-party feature writes to. */
const THIRD_PARTY_FOLDERS = new Set(['src', 'public', 'docs']);
const PLAIN_SEGMENT = /^[a-z0-9][a-z0-9._-]*$/;
const WINDOWS_SHORT_NAME = /~[0-9]/;
/** File names a test runner or a tool config loader would pick up: `test.js`, `a.test.ts`, `a-spec.js`, `test-utils.ts`, `vite.config.ts`. */
const TEST_OR_CONFIG_NAME =
  /^(?:test|spec)(?:[._-].*)?\.[a-z0-9]+$|[._-](?:test|spec)(?:\.[a-z0-9]+)+$|\.(?:bench|config)\.[a-z0-9]+$/;
/** Folders a test runner collects everything from. */
const TEST_FOLDERS = new Set(['test', 'tests', '__tests__', 'spec', 'specs', '__specs__']);

/** True for a file a test runner or tool config loader would pick up by name or by folder. */
export function isTestFilePath(file: string): boolean {
  const segments = policyKey(file).split('/');
  const name = segments.pop() ?? '';
  return TEST_OR_CONFIG_NAME.test(name) || segments.some((segment) => TEST_FOLDERS.has(segment));
}

function deny(file: string, why: string): never {
  throw new MfeflowError('E203', `"${file}" ${why}`);
}

/**
 * Where a third-party feature may write: an allowlist, not a list of bad
 * names. `relative` is the path inside the target; `joined` is the project
 * path. Only plain ASCII names under `src/`, `public/` or `docs/` pass, so no
 * dot folder, root file or package manager config can be named.
 */
export function assertThirdPartyPath(relative: string, joined: string): void {
  const key = policyKey(relative);
  const segments = key.split('/');
  if (segments.length < 2 || !THIRD_PARTY_FOLDERS.has(segments[0] ?? '')) {
    deny(relative, 'is outside src/, public/ and docs/, where third-party features may write');
  }
  for (const segment of segments) {
    if (!PLAIN_SEGMENT.test(segment) || WINDOWS_SHORT_NAME.test(segment)) {
      deny(relative, 'has a name that is not plain lower-case ASCII (letters, digits, . _ -)');
    }
  }
  if (isProtectedPath(relative) || isTestFilePath(relative)) {
    deny(relative, 'is a protected file (package manager, git hook, test or tool config)');
  }
  if (policyKey(joined).split('/')[0] === 'features') {
    deny(joined, 'is in the local features folder, which would later be trusted');
  }
  assertWritable(joined);
}
