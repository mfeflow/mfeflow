import { DOCS_URL, SCHEMA_URLS, errorDocsUrl } from '@mfeflow/contracts';

interface ErrorInfo {
  title: string;
  fix: string;
}

/**
 * Every error the engine throws. Ranges: E1xx project and config, E2xx
 * features, E3xx build and runtime, E4xx feature registries, E5xx deploy and the static registry.
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
    fix: `Fix the fields listed above. The schema is at ${SCHEMA_URLS.project}.`,
  },
  E105: {
    title: 'A path points outside the project',
    fix: 'Use paths relative to the project root, with forward slashes and no "..".',
  },
  E106: {
    title: 'A file could not be read or written',
    fix: 'Check that the file exists and that you have permission to change it.',
  },
  E107: {
    title: 'A command-line option is missing or not valid',
    fix: 'Run the command with --help to see the options and examples.',
  },
  E108: {
    title: 'The target folder is not empty',
    fix: 'Pick a new or empty folder, or move what is in the way.',
  },
  E109: {
    title: 'The preset could not be used',
    fix: 'Pass a JSON file or an https URL that holds an object of option names and values.',
  },
  E110: {
    title: '--local does not point at a built mfeflow checkout',
    fix: 'Pass the folder of a mfeflow/mfeflow clone where `pnpm install && pnpm build` has run.',
  },
  E111: {
    title: 'A workspace package has no version',
    fix: 'Add a "version" to its package.json (`mfeflow doctor --fix` writes 0.0.0). Without one Module Federation never shares the package and each app loads its own copy.',
  },
  E112: {
    title: 'An app in mfeflow.json is not on disk',
    fix: 'Restore the folder, or remove the app from "apps" in mfeflow.json.',
  },
  E113: {
    title: 'mfe.json is missing or invalid',
    fix: `Give the app a valid mfe.json (name, owner, shells, routes, exposes). The schema is at ${SCHEMA_URLS.mfe}.`,
  },
  E114: {
    title: 'A registry entry is missing or invalid',
    fix: `Every remote needs registry/envs/<env>/<name>.json for dev, staging and prod (\`mfeflow doctor --fix\` writes the missing ones). The schema is at ${SCHEMA_URLS.registryEntry}.`,
  },
  E115: {
    title: 'Two apps use the same port',
    fix: 'Give one of them another port in its rsbuild config and in "apps" in mfeflow.json.',
  },
  E116: {
    title: 'Two remotes claim routes that overlap, or an mfe.json disagrees with mfeflow.json',
    fix: 'Give each route to one remote (a wildcard such as /checkout/* also covers /checkout/pay), and keep the name in mfe.json equal to the app name.',
  },
  E117: {
    title: 'A copied file changed since mfeflow wrote it',
    fix: 'Nothing is wrong if you changed it on purpose. `mfeflow upgrade` will show a diff before touching it.',
  },
  E118: {
    title: '.env.example does not match the keys in env.ts',
    fix: 'List every key of the `server` schema in .env.example (`mfeflow add env-key KEY --scope server --schema "…"` keeps them together) and remove the ones env.ts no longer has.',
  },
  E119: {
    title: 'A runtime-config file does not match the runtime-config schema',
    fix: 'Give every runtime-config.<env>.json the keys of src/config/schema.ts and nothing else, then run `pnpm check:runtime-config` to validate the values.',
  },
  E120: {
    title: 'A PUBLIC_ variable would be baked into the bundle',
    fix: 'PUBLIC_* values are inlined at build time, so one build could no longer run in every environment. Put per-environment values in runtime-config.<env>.json instead (`mfeflow add env-key KEY --scope runtime --schema "…"`). PUBLIC_APP_NAME and PUBLIC_BUILD_VERSION are fine.',
  },
  E121: {
    title: 'A server env key is not listed in turbo.json',
    fix: 'Add the key to "globalEnv" in turbo.json. Turborepo hides unlisted variables from tasks and replays a cached build without running env.ts, so a missing value would not fail the build.',
  },
  E201: {
    title: 'Feature not found',
    fix: 'List what is available with `mfeflow features`, or check the spelling.',
  },
  E202: {
    title: 'feature.json is invalid',
    fix: `Fix the fields listed above. The schema is at ${SCHEMA_URLS.feature}.`,
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
    fix: 'Add it with `mfeflow registry add @someone https://example.com/{name}.json` (or under "registries" in mfeflow.json).',
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
  E215: {
    title: 'The app name cannot be used',
    fix: 'Use lowercase words of letters and digits joined by single underscores (order_history), starting with a letter, and a name no app has yet.',
  },
  E301: {
    title: 'A singleton resolves to more than one version',
    fix: 'Pin one version of the package in every app (the pnpm catalog is the place), then reinstall. Two copies of React break hooks.',
  },
  E302: {
    title: 'A remote is not compatible with its shell',
    fix: 'Align the remote and the shell on the same major of the package, or update the "platform" range in the remote\'s mfe.json.',
  },
  E303: {
    title: 'A runtime plugin imports a shared module',
    fix: 'Runtime plugins run before the share scope exists. Keep them dependency free and report through `window`.',
  },
  E304: {
    title: 'A bundle is over its budget',
    fix: 'Cut what the app ships on first load, or raise the budget in mfeflow.json ("budget") or mfe.json ("budgets") on purpose.',
  },
  E305: {
    title: 'There is no build output to measure',
    fix: 'Run `pnpm build` first.',
  },
  E306: {
    title: 'A dev server could not start',
    fix: "Free the port or change it in mfeflow.json and the app's rsbuild config, then run `mfeflow dev` again.",
  },
  E401: {
    title: 'Could not fetch from the registry',
    fix: 'Check the URL in "registries" and your network, then try again.',
  },
  E402: {
    title: 'The registry returned something that is not a feature',
    fix: 'Ask the registry owner to check the entry. It must be a feature.json document.',
  },
  E403: {
    title: "The registry's index.json is not valid",
    fix: 'Ask the registry owner to rebuild it with `mfeflow registry build`. It lists items with a name, version and description.',
  },
  E404: {
    title: 'A feature in the registry folder cannot be published',
    fix: 'Fix the features listed above. They are checked with the same rules `mfeflow add @namespace/name` applies, so a feature that passes here installs for users.',
  },
  E501: {
    title: 'A deploy failed the schema gate',
    fix: `Fix what the message names: the remote's mfe.json, its mf-manifest.json or the version. Nothing was uploaded. See ${DOCS_URL}/guide/deploy-and-rollback.`,
  },
  E502: {
    title: 'A route of this remote overlaps a route of another remote',
    fix: `Give each URL to one remote (/checkout/* also covers /checkout/pay), then deploy again. Nothing was uploaded. See ${DOCS_URL}/guide/deploy-and-rollback.`,
  },
  E503: {
    title: "The remote's shared ranges do not fit the shell that is deployed",
    fix: `Align the remote with the shell on the package named above, or deploy the shell first. Nothing was uploaded. See ${DOCS_URL}/guide/deploy-and-rollback.`,
  },
  E504: {
    title: 'The remote is over its first-load JS budget',
    fix: `Cut what the remote loads first, or raise budgets.initialJsKb in its mfe.json on purpose. Nothing was uploaded. See ${DOCS_URL}/guide/deploy-and-rollback.`,
  },
  E505: {
    title: 'A rollout was asked for, and a static host cannot split traffic',
    fix: `Deploy to one version at a time, or use the registry server for percentage rollouts. See ${DOCS_URL}/guide/deploy-and-rollback.`,
  },
  E506: {
    title: 'The registry host is not set up or cannot be used',
    fix: `Pass --host file:<dir> or s3://<bucket>[/prefix], or set registry.host in mfeflow.json. Deploys also need --base-url or registry.baseUrl. S3 settings come from MFEFLOW_S3_ENDPOINT, MFEFLOW_S3_REGION, AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY. See ${DOCS_URL}/guide/deploy-and-rollback.`,
  },
  E507: {
    title: 'There is no build output to deploy',
    fix: `Run \`pnpm build\` in the remote first. The build folder needs an mf-manifest.json, and the remote needs a version in package.json or --version. See ${DOCS_URL}/guide/deploy-and-rollback.`,
  },
  E508: {
    title: 'There is no such version to move to',
    fix: `Run \`mfeflow status\` to see what each environment serves and the versions you can go back to. See ${DOCS_URL}/guide/deploy-and-rollback.`,
  },
  E509: {
    title: 'Files of the target version are missing on the host',
    fix: `Deploy that version again from its build, or pick another version with --to. The index was not changed. See ${DOCS_URL}/guide/deploy-and-rollback.`,
  },
  E510: {
    title: 'Another deploy changed the index at the same time',
    fix: `Run \`mfeflow status\` to see what is served now, then run the command again. The index was not changed by this run. See ${DOCS_URL}/guide/deploy-and-rollback.`,
  },
  E511: {
    title: 'This version is already published with different content',
    fix: `A published version never changes. Bump the version and deploy again. See ${DOCS_URL}/guide/deploy-and-rollback.`,
  },
  E512: {
    title: 'Local registry files and the host disagree',
    fix: `Run the deploy, promote or rollback that was meant to move the environment, or fix registry/envs by hand. Artifacts uploaded with --no-publish are not served until you deploy them. See ${DOCS_URL}/guide/deploy-and-rollback.`,
  },
  E405: {
    title: 'The registry is not trusted yet',
    fix: 'Run `mfeflow registry trust @namespace` once to allow requests to it, or remove it from "registries".',
  },
  E406: {
    title: 'The registry changed a feature since you added it',
    fix: 'Nothing was written. Look at what changed; if you accept the new content, run the command again with --accept-changed-content.',
  },
} as const satisfies Record<string, ErrorInfo>;

export type ErrorCode = keyof typeof ERROR_CATALOGUE;

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
    this.docs = errorDocsUrl(code);
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
