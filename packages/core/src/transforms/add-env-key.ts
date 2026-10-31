import { isIdentifier, isObjectProperty, isStringLiteral } from '@babel/types';
import type { AddEnvKeyOp, Literal } from '@mfeflow/contracts';
import { MfeflowError, messageOf } from '../errors.js';
import {
  appendItem,
  applyEdits,
  detectQuote,
  findObject,
  literalSource,
  parseSource,
} from './ast.js';

function indentOfJson(source: string): string | number {
  return /^[ \t]+(?=")/m.exec(source)?.[0] ?? 2;
}

function addToJson(source: string, file: string, op: AddEnvKeyOp): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new MfeflowError('E208', `${file} is not valid JSON (${messageOf(error)})`, {
      cause: error,
    });
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new MfeflowError('E208', `${file} is not a JSON object`);
  }
  if (op.key in parsed) return source;
  const next = { ...parsed, [op.key]: op.value === undefined ? '' : op.value };
  return `${JSON.stringify(next, null, indentOfJson(source))}${source.endsWith('\n') ? '\n' : ''}`;
}

function addToObject(source: string, file: string, op: AddEnvKeyOp): string {
  const ast = parseSource(source, file);
  const name = op.object ?? 'runtimeConfig';
  const object = findObject(ast, name);
  if (!object) throw new MfeflowError('E208', `${file} has no object named "${name}"`);
  const present = object.properties.some(
    (p) =>
      isObjectProperty(p) &&
      ((isIdentifier(p.key) && p.key.name === op.key) ||
        (isStringLiteral(p.key) && p.key.value === op.key)),
  );
  if (present) return source;
  const q = detectQuote(source, ast);
  const value: Literal = op.value === undefined ? '' : op.value;
  const key = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(op.key) ? op.key : literalSource(op.key, q);
  return applyEdits(
    source,
    appendItem(source, object, object.properties, `${key}: ${literalSource(value, q)}`),
  );
}

/** Adds a key to the runtime config: a JSON file, or an object literal in a TypeScript file. */
export function addEnvKey(source: string, file: string, op: AddEnvKeyOp): string {
  return file.endsWith('.json') ? addToJson(source, file, op) : addToObject(source, file, op);
}
