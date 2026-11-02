// Stages each app's build for one environment and deploys it to Cloudflare Workers. It is your code:
// change it freely. The build is made once; only the staged copy differs per environment.
//
//   node scripts/deploy-cloudflare.ts <staging|prod> [app...]    stage, then wrangler deploy
//   node scripts/deploy-cloudflare.ts <env> [app...] --prepare-only   stage only (CI runs wrangler itself)
//   node scripts/deploy-cloudflare.ts <env> [app...] --dry-run        stage and print the wrangler commands
//   node scripts/deploy-cloudflare.ts plan <env>[,env]                print the CI matrix as JSON
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ENVS = ['staging', 'prod'];
const STAGE = '.mfeflow/cloudflare';
const SHELL_ORIGIN_TOKEN = '__SHELL_ORIGIN__';

interface Project {
  shell: string;
  remotes: string[];
  packageDirs: Record<string, string>;
}

interface EnvConfig {
  shell?: string;
  remotes?: Record<string, string>;
}

interface Config {
  registry: string;
  envs: Record<string, EnvConfig>;
}

function readJson(file: string): unknown {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    throw new Error(`${file} is missing`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${file} is not valid JSON`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readProject(root: string): Project {
  const file = path.join(root, 'mfeflow.json');
  const json = readJson(file);
  const apps = isRecord(json) && isRecord(json.apps) ? json.apps : {};
  let shell = '';
  const remotes: string[] = [];
  const packageDirs: Record<string, string> = {};
  for (const [name, app] of Object.entries(apps)) {
    if (!isRecord(app) || typeof app.path !== 'string') continue;
    // These end up in file paths and in the CI matrix, so keep to what mfeflow itself allows.
    if (
      !/^[a-z][a-z0-9_]*$/.test(name) ||
      !/^[\w.-]+(\/[\w.-]+)*$/.test(app.path) ||
      app.path.split('/').includes('..')
    ) {
      throw new Error(`${file}: app "${name}" has a name or path this script will not use`);
    }
    packageDirs[name] = app.path;
    if (app.kind === 'shell') shell = name;
    if (app.kind === 'remote') remotes.push(name);
  }
  if (shell === '') throw new Error(`${file} has no shell app`);
  return { shell, remotes, packageDirs };
}

export function readConfig(root: string): Config {
  const json = readJson(path.join(root, 'deploy/cloudflare.json'));
  if (!isRecord(json) || !isRecord(json.envs))
    throw new Error('deploy/cloudflare.json has no "envs"');
  const envs: Record<string, EnvConfig> = {};
  for (const [name, value] of Object.entries(json.envs)) {
    if (!isRecord(value)) continue;
    const remotes: Record<string, string> = {};
    if (isRecord(value.remotes)) {
      for (const [remote, origin] of Object.entries(value.remotes)) {
        if (typeof origin === 'string') remotes[remote] = origin;
      }
    }
    envs[name] = { remotes, ...(typeof value.shell === 'string' ? { shell: value.shell } : {}) };
  }
  return { registry: json.registry === 'r2' ? 'r2' : 'assets', envs };
}

/**
 * The origin (scheme and host) of an address, or an error saying which setting is wrong. https only;
 * http is accepted for localhost outside prod, for trying a deploy on your own machine.
 */
export function checkOrigin(value: string | undefined, label: string, env = 'staging'): string {
  if (value === undefined || value === '') {
    throw new Error(
      `${label} is empty. Set it in deploy/cloudflare.json to the address people will use.`,
    );
  }
  // The URL parser drops tabs and newlines, so a value with one would pass as something else.
  if (
    /\s/.test(value) ||
    Array.from(value, (c) => c.charCodeAt(0)).some((n) => n < 32 || n === 127)
  ) {
    throw new Error(`${label} must not contain spaces or control characters`);
  }
  const url = URL.canParse(value) ? new URL(value) : undefined;
  const local = url?.protocol === 'http:' && url.hostname === 'localhost' && env !== 'prod';
  if (url === undefined || (url.protocol !== 'https:' && !local)) {
    throw new Error(`${label} must be an https address, got "${value}"`);
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error(`${label} must not contain a user name or password`);
  }
  if (/(^|\.)example\.(com|org|net)$/.test(url.hostname)) {
    throw new Error(
      `${label} still holds the placeholder "${value}". Put your real address in deploy/cloudflare.json.`,
    );
  }
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    throw new Error(`${label} must be an origin without a path, got "${value}"`);
  }
  return url.origin;
}

export interface IndexEntry {
  name: string;
  version: string;
  entry: string;
  routes: string[];
}

export function buildIndex(env: string, remotes: IndexEntry[]): string {
  return `${JSON.stringify({ env, remotes }, null, 2)}\n`;
}

function selectApps(project: Project, config: Config, requested: string[]): string[] {
  const deployable =
    config.registry === 'r2' ? [project.shell] : [project.shell, ...project.remotes];
  if (requested.length === 0) return deployable;
  for (const app of requested) {
    if (!deployable.includes(app))
      throw new Error(`"${app}" is not an app this project deploys (${deployable.join(', ')})`);
  }
  return requested;
}

function packageVersion(root: string, project: Project, app: string): string {
  const dir = project.packageDirs[app] ?? `apps/${app}`;
  const json = readJson(path.join(root, dir, 'package.json'));
  return isRecord(json) && typeof json.version === 'string' ? json.version : '0.0.0';
}

function stageDir(root: string, project: Project, app: string, env: string): string {
  return path.join(root, project.packageDirs[app] ?? `apps/${app}`, STAGE, env);
}

/** Copies the app's dist to its staging folder and applies this environment's settings. Returns the folder. */
export function prepareApp(root: string, app: string, env: string): string {
  const project = readProject(root);
  const config = readConfig(root);
  const envConfig = config.envs[env];
  if (envConfig === undefined)
    throw new Error(`deploy/cloudflare.json has no "${env}" environment`);
  const dist = path.join(root, project.packageDirs[app] ?? `apps/${app}`, 'dist');
  if (!fs.existsSync(dist)) throw new Error(`${dist} does not exist. Run the build first.`);

  const out = stageDir(root, project, app, env);
  fs.rmSync(out, { recursive: true, force: true });
  fs.cpSync(dist, out, { recursive: true });

  if (app === project.shell) prepareShell(root, project, config, envConfig, env, out);
  else prepareRemote(app, envConfig, env, out);
  return out;
}

function prepareShell(
  root: string,
  project: Project,
  config: Config,
  envConfig: EnvConfig,
  env: string,
  out: string,
): void {
  checkOrigin(envConfig.shell, `envs.${env}.shell`, env);
  const configDir = path.join(out, 'config');
  const chosen = path.join(configDir, `runtime-config.${env}.json`);
  if (!fs.existsSync(chosen)) throw new Error(`The build has no config/runtime-config.${env}.json`);
  const runtime = readJson(chosen);
  const values: Record<string, unknown> = isRecord(runtime) ? runtime : {};

  const origins = new Map<string, string>();
  if (config.registry === 'assets') {
    for (const remote of project.remotes) {
      origins.set(
        remote,
        checkOrigin(envConfig.remotes?.[remote], `envs.${env}.remotes.${remote}`, env),
      );
    }
    const known = Array.isArray(values.registryOrigins)
      ? values.registryOrigins.filter((o) => typeof o === 'string')
      : [];
    values.registryOrigins = [...new Set([...known, ...origins.values()])];
    const entries = project.remotes.map((remote) => ({
      name: remote,
      version: packageVersion(root, project, remote),
      entry: `${origins.get(remote) ?? ''}/mf-manifest.json`,
      routes: [`/${remote}`],
    }));
    fs.mkdirSync(path.join(out, 'registry'), { recursive: true });
    fs.writeFileSync(path.join(out, 'registry/index.json'), buildIndex(env, entries));
  }

  for (const file of fs.readdirSync(configDir)) {
    if (/^runtime-config\..+\.json$/.test(file)) fs.rmSync(path.join(configDir, file));
  }
  fs.writeFileSync(
    path.join(configDir, 'runtime-config.json'),
    `${JSON.stringify(values, null, 2)}\n`,
  );
}

function prepareRemote(app: string, envConfig: EnvConfig, env: string, out: string): void {
  const shellOrigin = checkOrigin(envConfig.shell, `envs.${env}.shell`, env);
  if (!fs.existsSync(path.join(out, 'mf-manifest.json')))
    throw new Error(`${out} has no mf-manifest.json. Is this a remote build?`);
  const headers = path.join(out, '_headers');
  if (!fs.existsSync(headers)) {
    throw new Error(
      `${out} has no _headers, so the shell could not load ${app} across origins. Keep apps/${app}/public/_headers and rebuild.`,
    );
  }
  fs.writeFileSync(
    headers,
    fs.readFileSync(headers, 'utf8').replaceAll(SHELL_ORIGIN_TOKEN, () => shellOrigin),
  );
}

export interface Target {
  app: string;
  env: string;
  /** The app's wrangler config, relative to the project root. */
  config: string;
}

/** The CI matrix: one entry per app and environment. */
export function plan(root: string, envs: string[]): Target[] {
  for (const env of envs) {
    if (!ENVS.includes(env)) throw new Error(`unknown environment "${env}" (${ENVS.join(', ')})`);
  }
  const project = readProject(root);
  const apps = selectApps(project, readConfig(root), []);
  return envs.flatMap((env) =>
    apps.map((app) => ({
      app,
      env,
      config: `${project.packageDirs[app] ?? `apps/${app}`}/wrangler.jsonc`,
    })),
  );
}

function wranglerArgs(app: string, env: string, project: Project): string[] {
  const dir = project.packageDirs[app] ?? `apps/${app}`;
  return ['deploy', '--config', `${dir}/wrangler.jsonc`, '--env', env];
}

/** Wrangler's own script, so it can run under node without a shell, which works on every OS. */
function wranglerScript(root: string): string {
  const manifest = path.join(root, 'node_modules/wrangler/package.json');
  const json = readJson(manifest);
  const bin = isRecord(json) && isRecord(json.bin) ? json.bin.wrangler : undefined;
  if (typeof bin !== 'string')
    throw new Error(`${manifest} names no wrangler script. Run pnpm install.`);
  return path.join(path.dirname(manifest), bin);
}

export function main(argv: string[], root = process.cwd()): number {
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const [first, ...rest] = argv.filter((a) => !a.startsWith('--'));
  try {
    if (first === 'plan') {
      console.log(JSON.stringify(plan(root, (rest[0] ?? '').split(',').filter(Boolean))));
      return 0;
    }
    if (first === undefined || !ENVS.includes(first)) {
      throw new Error(
        `usage: deploy-cloudflare <${ENVS.join('|')}> [app...] [--prepare-only] [--dry-run]`,
      );
    }
    const project = readProject(root);
    for (const app of selectApps(project, readConfig(root), rest)) {
      const out = prepareApp(root, app, first);
      console.log(`staged ${app} for ${first}: ${path.relative(root, out)}`);
      if (flags.has('--prepare-only')) continue;
      const args = wranglerArgs(app, first, project);
      if (flags.has('--dry-run')) {
        console.log(`wrangler ${args.join(' ')}`);
        continue;
      }
      const run = spawnSync(process.execPath, [wranglerScript(root), ...args], {
        cwd: root,
        stdio: 'inherit',
      });
      if (run.status !== 0) throw new Error(`wrangler deploy failed for ${app}`);
    }
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return 1;
  }
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === import.meta.filename) {
  process.exitCode = main(process.argv.slice(2));
}
