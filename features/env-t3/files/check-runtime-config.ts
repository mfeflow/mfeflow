// Validates every public/config/runtime-config*.json against the schema in the same app's
// src/config/schema.ts. Run it before a deploy: pnpm check:runtime-config [env ...]
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

interface Issue {
  message: string;
  path?: readonly unknown[];
}

type Result = { issues?: readonly Issue[] };

interface StandardSchema {
  '~standard': { validate: (value: unknown) => Result | Promise<Result> };
}

interface Outcome {
  checked: number;
  failures: string[];
}

const ENV_FILE = /^runtime-config(?:\.([a-z0-9-]+))?\.json$/;
const root = process.cwd();
const wanted = process.argv.slice(2);

function isObject(value: unknown): value is object {
  return (typeof value === 'object' || typeof value === 'function') && value !== null;
}

function isStandardSchema(value: unknown): value is StandardSchema {
  if (!isObject(value) || !('~standard' in value)) return false;
  const meta = value['~standard'];
  return isObject(meta) && 'validate' in meta && typeof meta.validate === 'function';
}

function appDirs(): string[] {
  const project: unknown = JSON.parse(fs.readFileSync(path.join(root, 'mfeflow.json'), 'utf8'));
  const apps = isObject(project) && 'apps' in project ? project.apps : undefined;
  if (!isObject(apps)) return [];
  return Object.values(apps).flatMap((app: unknown) =>
    isObject(app) && 'path' in app && typeof app.path === 'string'
      ? [path.join(root, app.path)]
      : [],
  );
}

async function checkFile(schema: StandardSchema, file: string): Promise<string[]> {
  const shown = path.relative(root, file);
  let json: unknown;
  try {
    json = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    return [`${shown}: not valid JSON (${error instanceof Error ? error.message : String(error)})`];
  }
  const { issues = [] } = await schema['~standard'].validate(json);
  return issues.map((issue) => {
    const at = (issue.path ?? []).map(String).join('.');
    return `${shown}: ${at === '' ? '(root)' : at} ${issue.message}`;
  });
}

async function checkApp(dir: string): Promise<Outcome> {
  const schemaFile = path.join(dir, 'src', 'config', 'schema.ts');
  const configDir = path.join(dir, 'public', 'config');
  if (!fs.existsSync(schemaFile) || !fs.existsSync(configDir)) return { checked: 0, failures: [] };
  const loaded: unknown = await import(pathToFileURL(schemaFile).href);
  const schema =
    isObject(loaded) && 'runtimeConfigSchema' in loaded ? loaded.runtimeConfigSchema : undefined;
  if (!isStandardSchema(schema)) {
    return {
      checked: 0,
      failures: [
        `${path.relative(root, schemaFile)}: runtimeConfigSchema is not a Standard Schema`,
      ],
    };
  }
  const files = fs
    .readdirSync(configDir)
    .toSorted((a, b) => a.localeCompare(b))
    .filter((name) => {
      const match = ENV_FILE.exec(name);
      return match !== null && (wanted.length === 0 || wanted.includes(match[1] ?? ''));
    });
  const results = await Promise.all(
    files.map((name) => checkFile(schema, path.join(configDir, name))),
  );
  return { checked: files.length, failures: results.flat() };
}

const outcomes = await Promise.all(appDirs().map(checkApp));
const checked = outcomes.reduce((sum, o) => sum + o.checked, 0);
const failures = outcomes.flatMap((o) => o.failures);

for (const line of failures) console.error(line);
if (checked === 0 && failures.length === 0) {
  console.error(
    wanted.length > 0
      ? `no runtime-config.<env>.json found for ${wanted.join(', ')}`
      : 'no runtime-config files found',
  );
  process.exit(1);
}
if (failures.length > 0) process.exit(1);
console.log(`runtime config ok (${String(checked)} file${checked === 1 ? '' : 's'})`);
