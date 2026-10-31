import { isIdentifier, isObjectProperty, isStringLiteral, type ObjectProperty } from '@babel/types';
import type { AddEnvKeyOp, Literal } from '@mfeflow/contracts';
import { MfeflowError } from '../errors';
import { editJsonObject } from '../json';
import {
  appendItem,
  applyEdits,
  assertIdentifier,
  findObject,
  findServerSchema,
  endOf,
  literalSource,
  parseSource,
  startOf,
} from './ast';

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function placeholder(op: AddEnvKeyOp): Literal {
  return op.value === undefined ? '' : op.value;
}

function addToJson(source: string, file: string, op: AddEnvKeyOp): string {
  return editJsonObject(file, source, (json) => {
    if (Object.hasOwn(json, op.key)) return false;
    Object.defineProperty(json, op.key, {
      value: placeholder(op),
      enumerable: true,
      writable: true,
      configurable: true,
    });
    return true;
  });
}

function addToDotenv(source: string, op: AddEnvKeyOp): string {
  const exists = source
    .split('\n')
    .some((line) => line.trimStart().startsWith(`${op.key}=`) && !line.trimStart().startsWith('#'));
  if (exists) return source;
  const value = placeholder(op);
  const text = value === null ? '' : String(value);
  const rendered = /[\s#"']/.test(text) ? JSON.stringify(text) : text;
  const lead = source === '' || source.endsWith('\n') ? '' : '\n';
  return `${source}${lead}${op.key}=${rendered}\n`;
}

function keyName(property: ObjectProperty): string | undefined {
  if (isIdentifier(property.key)) return property.key.name;
  return isStringLiteral(property.key) ? property.key.value : undefined;
}

function addToSchema(source: string, file: string, op: AddEnvKeyOp): string {
  assertIdentifier(op.object, 'object');
  const ast = parseSource(source, file);
  const target =
    op.scope === 'server'
      ? findServerSchema(ast)
      : findObject(ast, op.object ?? 'runtimeConfigSchema');
  if (!target) {
    const where =
      op.scope === 'server'
        ? 'a createEnv({ server: { … } }) call'
        : `an object named "${op.object ?? 'runtimeConfigSchema'}"`;
    throw new MfeflowError('E208', `${file} has no ${where}`);
  }
  if (target.properties.some((p) => isObjectProperty(p) && keyName(p) === op.key)) return source;
  const key = IDENT.test(op.key) ? op.key : literalSource(op.key, "'");
  const edited = applyEdits(
    source,
    appendItem(source, target, target.properties, `${key}: ${op.schema}`),
  );
  try {
    parseSource(edited, file);
  } catch (cause) {
    throw new MfeflowError(
      'E208',
      `the schema ${JSON.stringify(op.schema)} for ${op.key} is not valid code`,
      {
        cause,
      },
    );
  }
  return edited;
}

/** Which kind of file `file` is, so one op can edit the schema, `.env.example` and the config JSON. */
function kindOf(file: string): 'json' | 'dotenv' | 'schema' {
  const base = file.slice(file.lastIndexOf('/') + 1);
  if (base.endsWith('.json')) return 'json';
  if (base.startsWith('.env')) return 'dotenv';
  return 'schema';
}

/** Every file (relative to the target) the op edits: the schema first, then the example or config files. */
export function envKeyFiles(op: AddEnvKeyOp): string[] {
  const rest = op.scope === 'server' ? [op.example ?? '.env.example'] : (op.configFiles ?? []);
  return [op.file, ...rest];
}

/**
 * Adds a typed env key to one file: the `server` schema in `env.ts` or the
 * runtime-config schema object, a `KEY=value` line in a dotenv file, or a
 * placeholder in a runtime-config JSON file. The kind comes from the file name.
 */
export function addEnvKey(source: string, file: string, op: AddEnvKeyOp): string {
  const kind = kindOf(file);
  if (kind === 'json') return addToJson(source, file, op);
  if (kind === 'dotenv') return addToDotenv(source, op);
  return addToSchema(source, file, op);
}

export interface SchemaKey {
  name: string;
  /** The schema accepts a missing value: it mentions optional, nullish, default or undefined. */
  optional: boolean;
}

const OPTIONAL = /optional|nullish|default|undefined/;

/**
 * The keys of the `server` schema (`env.ts`) or of the runtime-config schema object,
 * or undefined when the file has no such object. For `mfeflow doctor`, which compares them
 * with `.env.example` and the config files without running any of the project's code.
 */
export function schemaKeys(
  source: string,
  file: string,
  scope: AddEnvKeyOp['scope'],
  object = 'runtimeConfigSchema',
): SchemaKey[] | undefined {
  const ast = parseSource(source, file);
  const target = scope === 'server' ? findServerSchema(ast) : findObject(ast, object);
  if (!target) return undefined;
  return target.properties.flatMap((p) => {
    const name = isObjectProperty(p) ? keyName(p) : undefined;
    if (!isObjectProperty(p) || name === undefined) return [];
    return [{ name, optional: OPTIONAL.test(source.slice(startOf(p.value), endOf(p.value))) }];
  });
}

/** The variable names a dotenv file sets, ignoring comments. */
export function dotenvKeys(source: string): string[] {
  return source.split('\n').flatMap((line) => {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    return match?.[1] === undefined ? [] : [match[1]];
  });
}

/**
 * Lists a server key under `globalEnv` in turbo.json. Turborepo hides variables it was not
 * told about from tasks and replays a cached build without running it, so a key missing here
 * would never reach `env.ts` and a missing value would not fail a cached build.
 */
export function addTurboEnv(source: string, file: string, key: string): string {
  return editJsonObject(file, source, (turbo) => {
    const listed: unknown[] = Array.isArray(turbo.globalEnv) ? turbo.globalEnv : [];
    if (listed.includes(key)) return false;
    turbo.globalEnv = [...listed, key];
    return true;
  });
}
