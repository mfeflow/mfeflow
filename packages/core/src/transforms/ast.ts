import { parse } from '@babel/parser';
import {
  isArrayExpression,
  isArrowFunctionExpression,
  isCallExpression,
  isFunctionDeclaration,
  isFunctionExpression,
  isIdentifier,
  isNode,
  isValidIdentifier,
  isObjectExpression,
  isObjectProperty,
  isStringLiteral,
  isTSAsExpression,
  isTSSatisfiesExpression,
  isVariableDeclaration,
  type ArrayExpression,
  type ArrowFunctionExpression,
  type BlockStatement,
  type File,
  type FunctionDeclaration,
  type FunctionExpression,
  type Node,
  type ObjectExpression,
} from '@babel/types';
import { MfeflowError, messageOf } from '../errors.js';
import type { Literal } from '@mfeflow/contracts';

/** An edit to the source text: replace `[start, end)` with `text`. Insert with start === end. */
export interface Edit {
  start: number;
  end: number;
  text: string;
}

/** Applies edits from the end backwards so earlier offsets stay valid. */
export function applyEdits(source: string, edits: Edit[]): string {
  return edits
    .toSorted((a, b) => b.start - a.start)
    .reduce((out, e) => out.slice(0, e.start) + e.text + out.slice(e.end), source);
}

export function parseSource(source: string, file: string): File {
  const typescript = /\.(tsx?|mts|cts)$/.test(file);
  const jsx = !/\.(mts|cts|ts)$/.test(file);
  try {
    return parse(source, {
      sourceType: 'module',
      plugins: [
        ...(typescript ? (['typescript'] as const) : []),
        ...(jsx ? (['jsx'] as const) : []),
      ],
    });
  } catch (error) {
    throw new MfeflowError('E208', `${file} could not be parsed (${messageOf(error)})`, {
      cause: error,
    });
  }
}

const SKIP_KEYS = new Set(['loc', 'leadingComments', 'trailingComments', 'innerComments', 'extra']);

/** Every node under `root` (including it) for which `match` returns true, in source order. */
export function findAll(root: Node, match: (node: Node) => boolean): Node[] {
  const found: Node[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!isNode(value)) return;
    if (match(value)) found.push(value);
    for (const [key, child] of Object.entries(value)) {
      if (!SKIP_KEYS.has(key)) visit(child);
    }
  };
  visit(root);
  return found;
}

export type FunctionNode = FunctionDeclaration | FunctionExpression | ArrowFunctionExpression;

/** `function name() {}` or `const name = () => {}` anywhere in the file. */
export function findFunction(ast: File, name: string): FunctionNode | undefined {
  for (const node of findAll(ast, (n) => isFunctionDeclaration(n) || isVariableDeclaration(n))) {
    if (isFunctionDeclaration(node) && node.id?.name === name) return node;
    if (isVariableDeclaration(node)) {
      for (const decl of node.declarations) {
        if (!isIdentifier(decl.id) || decl.id.name !== name) continue;
        const init = decl.init;
        if (isArrowFunctionExpression(init) || isFunctionExpression(init)) return init;
      }
    }
  }
  return undefined;
}

export function bodyOf(fn: FunctionNode): BlockStatement | undefined {
  return fn.body.type === 'BlockStatement' ? fn.body : undefined;
}

function unwrap(node: Node | null | undefined): Node | null | undefined {
  return isTSAsExpression(node) || isTSSatisfiesExpression(node) ? unwrap(node.expression) : node;
}

/** `const name = [...]` or `{ name: [...] }`, also behind `as const` or `satisfies`. */
export function findArray(ast: File, name: string): ArrayExpression | undefined {
  for (const node of findAll(ast, (n) => n.type === 'VariableDeclarator' || isObjectProperty(n))) {
    let key: string | undefined;
    let value: Node | null | undefined;
    if (node.type === 'VariableDeclarator') {
      key = isIdentifier(node.id) ? node.id.name : undefined;
      value = node.init;
    } else if (isObjectProperty(node)) {
      key = isIdentifier(node.key)
        ? node.key.name
        : isStringLiteral(node.key)
          ? node.key.value
          : undefined;
      value = node.value;
    }
    const array = unwrap(value);
    if (key === name && isArrayExpression(array)) return array;
  }
  return undefined;
}

/** `const name = { … }`, or `const name = z.object({ … })` (any call whose first argument is the object). */
export function findObject(ast: File, name: string): ObjectExpression | undefined {
  for (const node of findAll(ast, (n) => n.type === 'VariableDeclarator')) {
    if (node.type !== 'VariableDeclarator' || !isIdentifier(node.id) || node.id.name !== name)
      continue;
    const init = unwrap(node.init);
    if (isObjectExpression(init)) return init;
    const first = isCallExpression(init) ? init.arguments[0] : undefined;
    if (isObjectExpression(first)) return first;
  }
  return undefined;
}

/** The `server` object of `createEnv({ server: { … } })`. */
export function findServerSchema(ast: File): ObjectExpression | undefined {
  for (const node of findAll(ast, (n) => isCallExpression(n))) {
    if (!isCallExpression(node) || !isIdentifier(node.callee) || node.callee.name !== 'createEnv')
      continue;
    const options = node.arguments[0];
    if (!isObjectExpression(options)) continue;
    for (const p of options.properties) {
      if (
        isObjectProperty(p) &&
        isIdentifier(p.key) &&
        p.key.name === 'server' &&
        isObjectExpression(p.value)
      ) {
        return p.value;
      }
    }
  }
  return undefined;
}

export function lineStart(source: string, offset: number): number {
  return source.lastIndexOf('\n', offset - 1) + 1;
}

export function lineEnd(source: string, offset: number): number {
  const end = source.indexOf('\n', offset);
  return end === -1 ? source.length : end;
}

/** The whitespace that starts the line `offset` is on. */
export function indentAt(source: string, offset: number): string {
  const start = lineStart(source, offset);
  return /^[ \t]*/.exec(source.slice(start, offset))?.[0] ?? '';
}

export function startOf(node: Node): number {
  return node.start ?? 0;
}

export function endOf(node: Node): number {
  return node.end ?? 0;
}

/** The quote the file already uses for strings, judged from the first string literal. */
export function detectQuote(source: string, ast: File): "'" | '"' {
  const first = findAll(ast, isStringLiteral)[0];
  return first && source[startOf(first)] === '"' ? '"' : "'";
}

export function quote(value: string, q: "'" | '"'): string {
  const escaped = value.replace(/[\\'"\p{Cc}\u2028\u2029]/gu, (char) => {
    if (char === '\\' || char === q) return `\\${char}`;
    if (char === "'" || char === '"') return char;
    if (char === '\n') return '\\n';
    if (char === '\r') return '\\r';
    if (char === '\t') return '\\t';
    return `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`;
  });
  return `${q}${escaped}${q}`;
}

/** Throws E208 unless `value` can be written into code as a binding or property name. */
export function assertIdentifier(value: string | undefined, what: string): void {
  if (value !== undefined && !isValidIdentifier(value)) {
    throw new MfeflowError('E208', `${what} "${value}" is not a JavaScript identifier`);
  }
}

export const JSX_ATTRIBUTE = /^[A-Za-z_$][A-Za-z0-9_$]*(-[A-Za-z0-9_$]+)*$/;

/** Throws E208 unless `value` is a plain JSX attribute name (`mode`, `data-id`). */
export function assertJsxAttribute(value: string): void {
  if (!JSX_ATTRIBUTE.test(value)) {
    throw new MfeflowError('E208', `prop "${value}" is not a JSX attribute name`);
  }
}

export function literalSource(value: Literal, q: "'" | '"'): string {
  return typeof value === 'string' ? quote(value, q) : String(value);
}

/**
 * Edits that append `text` as a new item of an array or object literal, in
 * the layout the literal already has: one per line when it spans lines. A
 * closing bracket on the last item's line stays where it is, after the new item.
 */
export function appendItem(
  source: string,
  node: { start?: number | null; end?: number | null },
  items: Node[],
  text: string,
): Edit[] {
  const start = node.start ?? 0;
  const end = node.end ?? 0;
  const last = items.at(-1);
  if (!last) return [{ start: start + 1, end: start + 1, text }];
  const multiline = source.slice(start, end).includes('\n');
  if (!multiline) return [{ start: endOf(last), end: endOf(last), text: `, ${text}` }];
  const indent = indentAt(source, startOf(last));
  const between = source.slice(endOf(last), end - 1);
  if (!between.includes('\n')) {
    const comma = between.indexOf(',');
    const at = endOf(last) + comma + 1;
    return comma === -1
      ? [{ start: endOf(last), end: endOf(last), text: `,\n${indent}${text}` }]
      : [{ start: at, end: at, text: `\n${indent}${text},` }];
  }
  const eol = lineEnd(source, endOf(last));
  const tail = source.slice(endOf(last), eol);
  const trailingComma = tail.trimStart().startsWith(',');
  const edits: Edit[] = [
    { start: eol, end: eol, text: `\n${indent}${text}${trailingComma ? ',' : ''}` },
  ];
  if (!trailingComma) edits.push({ start: endOf(last), end: endOf(last), text: ',' });
  return edits;
}
