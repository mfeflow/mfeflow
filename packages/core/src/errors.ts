interface ErrorInfo {
  title: string;
  fix: string;
}

/**
 * Every error the engine throws. Ranges: E1xx project and config, E2xx
 * features, E3xx build and runtime, E4xx registry, E5xx upgrade.
 */
export const ERROR_CATALOGUE = {
  E101: {
    title: 'A shared singleton is missing from the shared list',
    fix: 'Run `mfeflow doctor --fix`, or add the package to the singletons list.',
  },
  E102: {
    title: 'No mfeflow.json found',
    fix: 'Run the command inside an mfeflow project, pass --cwd, or create one with `npm create mfeflow@latest`.',
  },
  E103: {
    title: 'mfeflow.json is not valid JSON',
    fix: 'Fix the syntax error, or restore the file from git.',
  },
  E104: {
    title: 'mfeflow.json does not match its schema',
    fix: 'Fix the fields listed above. The schema is at https://mfeflow.dev/schema/mfeflow.json.',
  },
  E105: {
    title: 'A path points outside the project',
    fix: 'Use paths relative to the project root, with forward slashes and no "..".',
  },
  E106: {
    title: 'A file could not be read or written',
    fix: 'Check that the file exists and that you have permission to change it.',
  },
  E201: {
    title: 'Feature not found',
    fix: 'List what is available with `mfeflow features`, or check the spelling.',
  },
  E202: {
    title: 'feature.json is invalid',
    fix: 'Fix the fields listed above. The schema is at https://mfeflow.dev/schema/feature.json.',
  },
  E203: {
    title: 'A third-party feature uses something third-party features may not',
    fix: 'Third-party features are declarative: files under src/, public/ and docs/, registry dependencies, plain script names and the built-in transform ops (not add-workflow-step). Ask the author to remove it, or do not add this feature.',
  },
  E204: {
    title: 'Unknown transform op',
    fix: 'Built-in ops: add-import, wrap-provider, add-shared, add-boot-step, add-env-key, add-route, add-workflow-step. If you need another, open an issue.',
  },
  E205: {
    title: 'Feature conflicts with an installed feature',
    fix: 'Remove the conflicting feature first, or pick one of the two.',
  },
  E206: {
    title: 'Feature needs another feature first',
    fix: 'Add the required feature in the same command, for example `mfeflow add tsconfig this-feature`.',
  },
  E207: {
    title: 'The feature wants to create or change something that already exists',
    fix: 'Move or delete the existing file, script or dependency range, or edit it by hand and skip that part of the feature.',
  },
  E208: {
    title: 'A file the feature edits is missing or not shaped as expected',
    fix: 'Restore the file from the template, or apply the change by hand using the diff.',
  },
  E209: {
    title: 'A template could not be rendered',
    fix: 'Check the template for typos and that every option it uses is defined.',
  },
  E210: {
    title: 'Registry namespace is not configured',
    fix: 'Add it to "registries" in mfeflow.json, for example { "@someone": "https://example.com/{name}.json" }.',
  },
  E211: {
    title: 'Files changed since the plan was made',
    fix: 'Nothing was written. Run the command again to plan against the current files.',
  },
  E212: {
    title: 'Applying the plan failed',
    fix: 'Everything already written was rolled back. Fix the cause above and run the command again.',
  },
  E213: {
    title: 'Installing dependencies failed',
    fix: 'The files the plan wrote, and any package.json, lockfile or workspace file the install changed, were restored. node_modules is not rolled back, so run your package manager install once. Then check your network and package manager and run the command again.',
  },
  E214: {
    title: 'A feature option is invalid',
    fix: 'Pass a value the feature accepts; `mfeflow features <name>` lists the options.',
  },
  E401: {
    title: 'Could not fetch from the registry',
    fix: 'Check the URL in "registries" and your network, then try again.',
  },
  E402: {
    title: 'The registry returned something that is not a feature',
    fix: 'Ask the registry owner to check the entry. It must be a feature.json document.',
  },
} as const satisfies Record<string, ErrorInfo>;

export type ErrorCode = keyof typeof ERROR_CATALOGUE;

export const DOCS_BASE = 'https://mfeflow.dev/errors';

export interface MfeflowErrorOptions {
  cause?: unknown;
  /** Replaces the catalogue's fix when the situation has a more specific one. */
  fix?: string;
}

/** An error with a stable code, a fix hint and a docs link. */
export class MfeflowError extends Error {
  readonly code: `MFEFLOW_${ErrorCode}`;
  readonly fix: string;
  readonly docs: string;

  constructor(code: ErrorCode, detail?: string, options: MfeflowErrorOptions = {}) {
    const info: ErrorInfo = ERROR_CATALOGUE[code];
    super(detail ? `${info.title}: ${detail}` : info.title, { cause: options.cause });
    this.name = 'MfeflowError';
    this.code = `MFEFLOW_${code}`;
    this.fix = options.fix ?? info.fix;
    this.docs = `${DOCS_BASE}/${code}`;
  }

  /** The three-line form the CLI prints. */
  format(): string {
    return `${this.code} ${this.message}\n  Fix: ${this.fix}\n  ${this.docs}`;
  }
}

export function isMfeflowError(value: unknown): value is MfeflowError {
  return value instanceof MfeflowError;
}

/** Message of anything thrown, for error details. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** True for a Node file system error with this code, such as ENOENT. */
export function hasErrno(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}
