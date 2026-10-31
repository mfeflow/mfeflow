import { parseExpression } from '@babel/parser';
import {
  isBooleanLiteral,
  isCallExpression,
  isIdentifier,
  isMemberExpression,
  isNullLiteral,
  isNumericLiteral,
  isObjectProperty,
  isStringLiteral,
  isUnaryExpression,
  type Node,
} from '@babel/types';
import type { AddEnvKeyOp } from '@mfeflow/contracts';
import { MfeflowError, messageOf } from '../errors';
import { quote } from '../transforms/ast';

/** The validator libraries a typed env schema may call: zod, valibot, arktype. */
const ROOTS = new Set(['z', 'v', 'type']);
const MEMBER = /^[a-z][A-Za-z0-9]*$/;
/** Names that reach `Function` or the prototype chain from any function or object. */
const GADGETS = new Set(['constructor', 'prototype', 'call', 'apply', 'bind']);
const MAX_LENGTH = 1000;
const MAX_DEPTH = 8;

/**
 * Validates the `schema` text of a third-party `add-env-key` and returns it
 * re-emitted from the parsed tree. The text is pasted into the user's source
 * and runs when the app starts, so only a call chain on `z`, `v` or `type`
 * with literal arguments (and nested chains) is accepted, and the output is
 * built from the tree, never from the input, so no comment or trailing text
 * survives. With `form.string` (arktype's own syntax, `'string.url'`) a plain
 * string literal is accepted too, re-emitted with its quotes escaped.
 */
export function sanitizeSchema(
  schema: string,
  label: string,
  form: { string?: boolean } = {},
): string {
  const deny = (why: string): never => {
    throw new MfeflowError('E203', `${label}: add-env-key schema ${why}`);
  };
  if (schema.length > MAX_LENGTH) deny(`is longer than ${String(MAX_LENGTH)} characters`);

  const emit = (node: Node, depth: number): string => {
    if (depth > MAX_DEPTH) return deny('is nested too deeply');
    if (isStringLiteral(node)) return quote(node.value, "'");
    if (isNumericLiteral(node)) return String(node.value);
    if (isBooleanLiteral(node)) return String(node.value);
    if (isNullLiteral(node)) return 'null';
    if (isUnaryExpression(node) && node.operator === '-' && isNumericLiteral(node.argument)) {
      return `-${String(node.argument.value)}`;
    }
    if (node.type === 'ArrayExpression') {
      const items = node.elements.map((e) =>
        e === null ? deny('has a hole') : emit(e, depth + 1),
      );
      return `[${items.join(', ')}]`;
    }
    if (node.type === 'ObjectExpression') {
      const props = node.properties.map((p) => {
        if (!isObjectProperty(p) || p.computed || p.shorthand) return deny('has a computed key');
        const key = isIdentifier(p.key)
          ? p.key.name
          : isStringLiteral(p.key)
            ? quote(p.key.value, "'")
            : deny('has an unsupported key');
        return `${key}: ${emit(p.value, depth + 1)}`;
      });
      return props.length === 0 ? '{}' : `{ ${props.join(', ')} }`;
    }
    return emitChain(node, depth);
  };

  const emitChain = (node: Node, depth: number): string => {
    if (isIdentifier(node)) {
      return ROOTS.has(node.name) ? node.name : deny(`uses "${node.name}", not z, v or type`);
    }
    if (isMemberExpression(node)) {
      const property = node.property;
      if (node.computed || !isIdentifier(property)) {
        return deny('uses a computed member');
      }
      if (!MEMBER.test(property.name) || GADGETS.has(property.name)) {
        return deny(`uses the member "${property.name}"`);
      }
      return `${emitChain(node.object, depth + 1)}.${property.name}`;
    }
    if (isCallExpression(node)) {
      const args = node.arguments.map((a) => emit(a, depth + 1));
      return `${emitChain(node.callee, depth + 1)}(${args.join(', ')})`;
    }
    return deny(`has ${node.type}, which is not a call on z, v or type with literal arguments`);
  };

  let tree: Node;
  try {
    tree = parseExpression(schema);
  } catch (error) {
    return deny(`is not a single expression (${messageOf(error)})`);
  }
  if (form.string === true && isStringLiteral(tree)) return quote(tree.value, "'");
  if (!isCallExpression(tree)) {
    return deny(
      form.string === true
        ? "must be a string literal such as 'string.url' or a call"
        : 'must be a call such as z.string().url()',
    );
  }
  return emit(tree, 0);
}

/** `sanitizeSchema` for a single text or a per-validator map. */
export function sanitizeSchemas(
  schema: AddEnvKeyOp['schema'],
  label: string,
): AddEnvKeyOp['schema'] {
  if (typeof schema === 'string') return sanitizeSchema(schema, label);
  return Object.fromEntries(
    Object.entries(schema).map(([validator, text]) => [
      validator,
      sanitizeSchema(text, label, { string: validator === 'arktype' }),
    ]),
  );
}
