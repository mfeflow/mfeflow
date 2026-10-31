import { isIdentifier, isObjectProperty, isStringLiteral } from '@babel/types';
import type { AddEnvKeyOp, Literal } from '@mfeflow/contracts';
import { MfeflowError } from '../errors';
import { editJsonObject } from '../json';
import {
  appendItem,
  applyEdits,
  assertIdentifier,
  findObject,
  findServerSchema,
  literalSource,
  parseSource,
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
  const present = target.properties.some(
    (p) =>
      isObjectProperty(p) &&
      ((isIdentifier(p.key) && p.key.name === op.key) ||
        (isStringLiteral(p.key) && p.key.value === op.key)),
  );
  if (present) return source;
  const key = IDENT.test(op.key) ? op.key : literalSource(op.key, "'");
  return applyEdits(source, appendItem(source, target, target.properties, `${key}: ${op.schema}`));
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
