import {
  isArrayExpression,
  isArrowFunctionExpression,
  isAssignmentExpression,
  isAwaitExpression,
  isBinaryExpression,
  isBooleanLiteral,
  isCallExpression,
  isClassDeclaration,
  isConditionalExpression,
  isExportDefaultDeclaration,
  isExportNamedDeclaration,
  isExportSpecifier,
  isExpressionStatement,
  isFunctionDeclaration,
  isFunctionExpression,
  isImportDeclaration,
  isImportDefaultSpecifier,
  isImportNamespaceSpecifier,
  isLogicalExpression,
  isNewExpression,
  isNullLiteral,
  isNumericLiteral,
  isObjectExpression,
  isTemplateLiteral,
  isUnaryExpression,
  isIdentifier,
  isMemberExpression,
  isMetaProperty,
  isObjectPattern,
  isObjectProperty,
  isStringLiteral,
  isTSAsExpression,
  isTSNonNullExpression,
  isTSSatisfiesExpression,
  isTSTypeAssertion,
  isVariableDeclaration,
  type ArrayExpression,
  type File,
  type Node,
  type ObjectExpression,
  type Statement,
} from '@babel/types';
import { findAll } from '../transforms/ast';

/** A value written out in full in the source: what the detector is allowed to trust. */
export type Value = string | number | boolean | null | Value[] | { [key: string]: Value };

export type Result<T> = { ok: true; value: T } | { ok: false; reason: string };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const fail = <T = never>(reason: string): Result<T> => ({ ok: false, reason });

/** What a top-level name in a file is bound to. */
export type Binding =
  | { kind: 'const'; init: Node }
  | { kind: 'import'; source: string; imported: string }
  | { kind: 'other'; what: string };

/** The top-level names and exports of one parsed file. */
export interface Scope {
  /** Absolute path of the file. */
  file: string;
  bindings: Map<string, Binding>;
  /** Exported name (`default` for the default export) to the exported expression. */
  exports: Map<string, Node>;
}

/** Strips `as`, `satisfies`, `!` and `<T>x` so only the value is left. */
export function unwrap(node: Node | null | undefined): Node | undefined {
  if (!node) return undefined;
  if (
    isTSAsExpression(node) ||
    isTSSatisfiesExpression(node) ||
    isTSNonNullExpression(node) ||
    isTSTypeAssertion(node)
  ) {
    return unwrap(node.expression);
  }
  return node;
}

/** The module name of `require('x')`, `require('x').a.b`, or undefined. */
function requireSource(
  node: Node | null | undefined,
): { source: string; path: string[] } | undefined {
  const n = unwrap(node);
  if (isCallExpression(n) && isIdentifier(n.callee, { name: 'require' })) {
    const arg = n.arguments[0];
    return isStringLiteral(arg) ? { source: arg.value, path: [] } : undefined;
  }
  if (isMemberExpression(n) && !n.computed && isIdentifier(n.property)) {
    const inner = requireSource(n.object);
    return inner ? { source: inner.source, path: [...inner.path, n.property.name] } : undefined;
  }
  return undefined;
}

function keyName(key: Node): string | undefined {
  if (isIdentifier(key)) return key.name;
  if (isStringLiteral(key)) return key.value;
  return undefined;
}

function bindVariables(statement: Statement, bindings: Map<string, Binding>): void {
  if (!isVariableDeclaration(statement)) return;
  for (const decl of statement.declarations) {
    const required = requireSource(decl.init);
    if (isIdentifier(decl.id)) {
      if (required) {
        bindings.set(decl.id.name, {
          kind: 'import',
          source: required.source,
          imported: required.path[0] ?? 'default',
        });
      } else if (statement.kind === 'const' && decl.init) {
        bindings.set(decl.id.name, { kind: 'const', init: decl.init });
      } else {
        bindings.set(decl.id.name, { kind: 'other', what: `a ${statement.kind} variable` });
      }
    } else if (isObjectPattern(decl.id)) {
      for (const prop of decl.id.properties) {
        if (!isObjectProperty(prop) || !isIdentifier(prop.value)) continue;
        const imported = keyName(prop.key);
        if (required && imported) {
          bindings.set(prop.value.name, { kind: 'import', source: required.source, imported });
        } else {
          bindings.set(prop.value.name, { kind: 'other', what: 'a destructured value' });
        }
      }
    }
  }
}

function isModuleExports(node: Node): boolean {
  return (
    isMemberExpression(node) &&
    isIdentifier(node.object, { name: 'module' }) &&
    isIdentifier(node.property, { name: 'exports' })
  );
}

/** Reads the top-level bindings and exports of a parsed file. */
export function scopeOf(ast: File, file: string): Scope {
  const bindings = new Map<string, Binding>();
  const exports = new Map<string, Node>();
  const localExports: [string, string][] = [];
  for (const statement of ast.program.body) {
    if (isImportDeclaration(statement)) {
      for (const spec of statement.specifiers) {
        const imported = isImportDefaultSpecifier(spec)
          ? 'default'
          : isImportNamespaceSpecifier(spec)
            ? '*'
            : (keyName(spec.imported) ?? '*');
        bindings.set(spec.local.name, {
          kind: 'import',
          source: statement.source.value,
          imported,
        });
      }
    } else if (isVariableDeclaration(statement)) {
      bindVariables(statement, bindings);
    } else if (isFunctionDeclaration(statement) || isClassDeclaration(statement)) {
      if (statement.id) {
        bindings.set(statement.id.name, { kind: 'other', what: 'a function or class' });
      }
    } else if (isExportNamedDeclaration(statement)) {
      const decl = statement.declaration;
      if (decl && isVariableDeclaration(decl)) {
        bindVariables(decl, bindings);
        for (const d of decl.declarations) {
          if (isIdentifier(d.id) && d.init) exports.set(d.id.name, d.init);
        }
      }
      if (!statement.source) {
        for (const spec of statement.specifiers) {
          if (!isExportSpecifier(spec)) continue;
          const exported = keyName(spec.exported);
          const local = keyName(spec.local);
          if (exported && local) localExports.push([exported, local]);
        }
      }
    } else if (isExportDefaultDeclaration(statement)) {
      exports.set('default', statement.declaration);
    } else if (isExpressionStatement(statement)) {
      const expr = statement.expression;
      if (isAssignmentExpression(expr) && isModuleExports(expr.left)) {
        exports.set('default', expr.right);
      }
    }
  }
  for (const [exported, local] of localExports) {
    const binding = bindings.get(local);
    if (binding?.kind === 'const') exports.set(exported, binding.init);
  }
  return { file, bindings, exports };
}

/** `process.env` or `import.meta.env` itself, as text. */
function isEnvObject(n: Node): string | undefined {
  if (!isMemberExpression(n) || n.computed || !isIdentifier(n.property, { name: 'env' })) {
    return undefined;
  }
  if (isIdentifier(n.object, { name: 'process' })) return 'process.env';
  if (isMetaProperty(n.object)) return 'import.meta.env';
  return undefined;
}

/** `process.env.X`, `process.env['X']` or `import.meta.env.X` under `node`, as text. */
export function envAccess(node: Node): string | undefined {
  for (const found of findAll(node, (n) => isMemberExpression(n) || isMetaProperty(n))) {
    if (isMemberExpression(found)) {
      const base = isEnvObject(found.object);
      if (base) {
        const key = isIdentifier(found.property)
          ? found.property.name
          : isStringLiteral(found.property)
            ? found.property.value
            : undefined;
        return key && (!found.computed || isStringLiteral(found.property))
          ? `${base}.${key}`
          : base;
      }
    }
    const whole = isEnvObject(found);
    if (whole) return whole;
  }
  return undefined;
}

function calleeName(node: Node): string {
  const n = unwrap(node);
  if (isIdentifier(n)) return n.name;
  if (isMemberExpression(n) && isIdentifier(n.property))
    return `${calleeName(n.object)}.${n.property.name}`;
  return 'a function';
}

/** Calls that only convert a value, so an env read inside them is the real story. */
const CONVERSIONS = new Set(['Number', 'String', 'Boolean', 'parseInt', 'parseFloat']);

/** Why `node` is not a literal value, in plain words. */
export function reasonFor(node: Node): string {
  const call =
    node.type === 'CallExpression' && !CONVERSIONS.has(calleeName(node.callee))
      ? calleeName(node.callee)
      : undefined;
  if (call) return `comes from a function call (${call}())`;
  const env = envAccess(node);
  if (env) return `reads an env variable (${env})`;
  if (isCallExpression(node)) return `comes from a function call (${calleeName(node.callee)}())`;
  if (isNewExpression(node)) return `is built with new ${calleeName(node.callee)}()`;
  if (isArrowFunctionExpression(node) || isFunctionExpression(node)) return 'is a function';
  if (isMemberExpression(node)) return `is read from another value (${calleeName(node)})`;
  if (isConditionalExpression(node)) return 'depends on a condition (a ? b : c)';
  if (isLogicalExpression(node) || isBinaryExpression(node)) {
    return `is computed with ${node.operator}`;
  }
  if (isTemplateLiteral(node)) return 'is a template string with ${} parts';
  if (isAwaitExpression(node)) return 'is awaited';
  return `is not a literal (${node.type})`;
}

function identifierReason(name: string, binding: Binding | undefined): string {
  if (!binding) return `refers to ${name}, which is not a const in this file`;
  if (binding.kind === 'import') {
    return `is imported (${name} from '${binding.source}')`;
  }
  return `refers to ${name}, which is ${binding.kind === 'other' ? binding.what : 'not a const'}`;
}

/**
 * Follows `const` names in the same file to the expression they hold, so a
 * caller can look at its shape. Stops at anything that is not a plain const.
 */
export function resolveNode(
  node: Node | null | undefined,
  scope: Scope,
  seen: ReadonlySet<string> = new Set(),
): Result<Node> {
  const n = unwrap(node);
  if (!n) return fail('is missing');
  if (!isIdentifier(n)) return ok(n);
  const binding = scope.bindings.get(n.name);
  if (binding?.kind !== 'const' || seen.has(n.name)) {
    return fail(
      seen.has(n.name)
        ? `refers to ${n.name}, which refers back to itself`
        : identifierReason(n.name, binding),
    );
  }
  return resolveNode(binding.init, scope, new Set([...seen, n.name]));
}

export interface Entry {
  key: string;
  value: Node;
}

/**
 * The properties of an object literal, with spreads of same-file const
 * objects folded in. Anything that cannot be read is a problem, keyed by the
 * property it belongs to when there is one.
 */
export function entriesOf(
  object: ObjectExpression,
  scope: Scope,
  seen: ReadonlySet<string> = new Set(),
): { entries: Entry[]; problems: { key?: string; reason: string }[] } {
  const entries: Entry[] = [];
  const problems: { key?: string; reason: string }[] = [];
  for (const prop of object.properties) {
    if (prop.type === 'SpreadElement') {
      const arg = unwrap(prop.argument);
      if (isIdentifier(arg)) {
        const binding = scope.bindings.get(arg.name);
        if (binding?.kind === 'import') {
          problems.push({
            reason: `spreads an imported object (${arg.name} from '${binding.source}')`,
          });
          continue;
        }
      }
      const target = resolveNode(arg, scope, seen);
      if (!target.ok) {
        problems.push({ reason: `spreads a value that ${target.reason}` });
      } else if (target.value.type === 'ObjectExpression') {
        const name = isIdentifier(arg) ? arg.name : '';
        const inner = entriesOf(target.value, scope, new Set([...seen, name]));
        entries.push(...inner.entries);
        problems.push(...inner.problems);
      } else {
        problems.push({ reason: `spreads a value that ${reasonFor(target.value)}` });
      }
      continue;
    }
    const key = prop.computed ? undefined : keyName(prop.key);
    if (key === undefined) {
      problems.push({ reason: 'has a computed key' });
      continue;
    }
    if (prop.type === 'ObjectMethod') {
      problems.push({ key, reason: 'is a method' });
      continue;
    }
    entries.push({ key, value: prop.value });
  }
  return { entries, problems };
}

function evaluateArray(
  array: ArrayExpression,
  scope: Scope,
  seen: ReadonlySet<string>,
): Result<Value> {
  const out: Value[] = [];
  for (const element of array.elements) {
    if (!element) return fail('has an empty slot');
    if (element.type === 'SpreadElement') return fail('spreads into an array');
    const item = evaluate(element, scope, seen);
    if (!item.ok) return item;
    out.push(item.value);
  }
  return ok(out);
}

/** The literal value of `node`, or why it has none. Only same-file `const` names are followed. */
export function evaluate(
  node: Node | null | undefined,
  scope: Scope,
  seen: ReadonlySet<string> = new Set(),
): Result<Value> {
  const n = unwrap(node);
  if (!n) return fail('is missing');
  if (isStringLiteral(n) || isNumericLiteral(n) || isBooleanLiteral(n)) return ok(n.value);
  if (isNullLiteral(n)) return ok(null);
  if (isTemplateLiteral(n)) {
    return n.expressions.length === 0
      ? ok(n.quasis.map((q) => q.value.cooked ?? q.value.raw).join(''))
      : fail(reasonFor(n));
  }
  if (isUnaryExpression(n)) {
    return n.operator === '-' && isNumericLiteral(n.argument)
      ? ok(-n.argument.value)
      : fail(reasonFor(n));
  }
  if (isIdentifier(n)) {
    const target = resolveNode(n, scope, seen);
    return target.ok ? evaluate(target.value, scope, new Set([...seen, n.name])) : target;
  }
  if (isObjectExpression(n)) {
    const { entries, problems } = entriesOf(n, scope, seen);
    const problem = problems[0];
    if (problem) return fail(problem.key ? `${problem.key} ${problem.reason}` : problem.reason);
    const out: Record<string, Value> = {};
    for (const entry of entries) {
      const value = evaluate(entry.value, scope, seen);
      if (!value.ok) return fail(`${entry.key} ${value.reason}`);
      out[entry.key] = value.value;
    }
    return ok(out);
  }
  if (isArrayExpression(n)) return evaluateArray(n, scope, seen);
  return fail(reasonFor(n));
}
