// What decision 0020 promises, checked on a generated project that has been built once:
//  - a missing server variable fails the build and the output names it;
//  - the built JavaScript holds neither the variable's value nor any validator code;
//  - a runtime-config file that does not match the schema fails the deploy check and the doctor.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Validator } from './combos.ts';

const SECRET = 'matrix-sentinel-secret-7f3a91';

const SCHEMAS: Record<Validator, { server: string; runtime: string; markers: string[] }> = {
  zod: { server: 'z.string().min(8)', runtime: 'z.string().min(1)', markers: ['ZodError'] },
  valibot: {
    server: 'v.pipe(v.string(), v.minLength(8))',
    runtime: 'v.pipe(v.string(), v.minLength(1))',
    markers: ['ValiError'],
  },
  arktype: { server: "type('string >= 8')", runtime: "type('string > 0')", markers: ['ArkError'] },
};

interface Ran {
  status: number;
  output: string;
}

function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): Ran {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    shell: process.platform === 'win32' && command === 'pnpm',
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: result.status ?? 1, output: `${result.stdout}${result.stderr}` };
}

function jsFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { recursive: true, encoding: 'utf8' }).flatMap((file) => {
    const full = path.join(dir, file);
    return file.endsWith('.js') && fs.statSync(full).isFile() ? [full] : [];
  });
}

/** Source of a package's published files, to prove a marker would be found if it were bundled. */
function packageSource(project: string, name: string): string {
  const dir = path.join(project, 'node_modules', ...name.split('/'));
  if (!fs.existsSync(dir)) return '';
  return fs
    .readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((file) => /\.(?:c?js|mjs)$/.test(file))
    .map((file) => fs.readFileSync(path.join(dir, file), 'utf8'))
    .join('\n');
}

/** Returns a description of the first promise that does not hold, or undefined. */
export function envChecks(project: string, cli: string, validator: Validator): string | undefined {
  const schemas = SCHEMAS[validator];
  const mfeflow = (...args: string[]) => run(process.execPath, [cli, ...args], project);
  const pnpm = (args: string[], env?: NodeJS.ProcessEnv) => run('pnpm', args, project, env);

  const server = mfeflow(
    'add',
    'env-key',
    'SENTINEL_SECRET',
    '--scope',
    'server',
    '--schema',
    schemas.server,
    '--yes',
  );
  if (server.status !== 0) return `add env-key (server) failed:\n${server.output}`;
  const runtime = mfeflow(
    'add',
    'env-key',
    'GTM_ID',
    '--scope',
    'runtime',
    '--schema',
    schemas.runtime,
    '--value',
    'GTM-MATRIX',
    '--yes',
  );
  if (runtime.status !== 0) return `add env-key (runtime) failed:\n${runtime.output}`;

  const without = pnpm(['build'], { SENTINEL_SECRET: '' });
  if (without.status === 0) return 'the build passed without SENTINEL_SECRET';
  if (!without.output.includes('SENTINEL_SECRET')) {
    return `the failed build does not name SENTINEL_SECRET:\n${without.output.slice(-2000)}`;
  }
  const withValue = pnpm(['build'], { SENTINEL_SECRET: SECRET });
  if (withValue.status !== 0)
    return `the build failed with SENTINEL_SECRET set:\n${withValue.output.slice(-2000)}`;

  const dists = ['apps/shell', 'apps/catalog'].map((app) => path.join(project, app, 'dist'));
  const bundles = dists.flatMap(jsFiles);
  if (bundles.length === 0) return 'no built JavaScript to inspect';
  const bundled = bundles.map((file) => ({ file, text: fs.readFileSync(file, 'utf8') }));
  const leaked = bundled.find(({ text }) => text.includes(SECRET));
  if (leaked) return `the env value is in the bundle ${leaked.file}`;

  const markers = [...schemas.markers, 'Invalid environment variables', 'createEnv'];
  const known = [
    packageSource(project, validatorPackage(validator)),
    packageSource(project, '@t3-oss/env-core'),
  ].join('\n');
  for (const marker of markers) {
    if (!known.includes(marker))
      return `control failed: ${marker} is not in the installed packages, so the bundle check proves nothing`;
    const found = bundled.find(({ text }) => text.includes(marker));
    if (found) return `validator code (${marker}) is in the bundle ${found.file}`;
  }

  const prod = path.join(project, 'apps/shell/public/config/runtime-config.prod.json');
  fs.writeFileSync(prod, '{ "GTM_ID": "GTM-MATRIX" }\n');
  const check = pnpm(['check:runtime-config', 'prod']);
  if (check.status === 0) return 'the runtime-config check passed a file without "environment"';
  if (!check.output.includes('runtime-config.prod.json') || !check.output.includes('environment')) {
    return `the runtime-config check does not name the file and key:\n${check.output.slice(-2000)}`;
  }
  const doctor = mfeflow('doctor');
  if (doctor.status === 0 || !doctor.output.includes('MFEFLOW_E119')) {
    return `doctor missed the bad runtime-config file:\n${doctor.output.slice(-2000)}`;
  }
  return undefined;
}

function validatorPackage(validator: Validator): string {
  return validator;
}
