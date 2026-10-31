import {
  isCallExpression,
  isIdentifier,
  isMemberExpression,
  type Node,
  type Statement,
} from '@babel/types';
import type { AddBootStepOp } from '@mfeflow/contracts';
import { MfeflowError } from '../errors.js';
import { addImport } from './add-import.js';
import {
  applyEdits,
  bodyOf,
  detectQuote,
  endOf,
  findAll,
  findFunction,
  indentAt,
  lineEnd,
  lineStart,
  literalSource,
  parseSource,
  startOf,
} from './ast.js';

const callsFunction = (name: string) => (node: Node) =>
  isCallExpression(node) && isIdentifier(node.callee) && node.callee.name === name;

const rendersTree = (node: Node) =>
  isCallExpression(node) &&
  isMemberExpression(node.callee) &&
  isIdentifier(node.callee.property) &&
  node.callee.property.name === 'render';

function statementWith(
  statements: Statement[],
  match: (node: Node) => boolean,
): Statement | undefined {
  return statements.find((s) => findAll(s, match).length > 0);
}

/** Adds `await call(...)` to the bootstrap function. Does nothing if `call` is already called in it. */
export function addBootStep(source: string, file: string, op: AddBootStepOp): string {
  const withImport = addImport(source, file, {
    op: 'add-import',
    file: op.file,
    from: op.from,
    ...(op.defaultImport ? { default: op.call } : { named: [op.call] }),
  });
  const ast = parseSource(withImport, file);
  const name = op.function ?? 'main';
  const fn = findFunction(ast, name);
  const body = fn && bodyOf(fn);
  if (!body) throw new MfeflowError('E208', `${file} has no function "${name}" with a body`);
  if (findAll(body, callsFunction(op.call)).length > 0) return withImport;

  const anchorName = op.before ?? op.after;
  const anchor = anchorName
    ? statementWith(body.body, callsFunction(anchorName))
    : statementWith(body.body, rendersTree);
  if (anchorName && !anchor) {
    throw new MfeflowError('E208', `${name} in ${file} has no step that calls "${anchorName}"`);
  }

  const q = detectQuote(withImport, ast);
  const args = (op.args ?? []).map((a) => literalSource(a, q)).join(', ');
  const statement = `${op.await === false ? '' : 'await '}${op.call}(${args});`;
  const last = body.body.at(-1);

  if (anchor && !op.after) {
    const at = lineStart(withImport, startOf(anchor));
    return applyEdits(withImport, [
      { start: at, end: at, text: `${indentAt(withImport, startOf(anchor))}${statement}\n` },
    ]);
  }
  const after = anchor ?? last;
  if (after) {
    const at = lineEnd(withImport, endOf(after));
    return applyEdits(withImport, [
      { start: at, end: at, text: `\n${indentAt(withImport, startOf(after))}${statement}` },
    ]);
  }
  const open = startOf(body) + 1;
  const indent = indentAt(withImport, startOf(body));
  return applyEdits(withImport, [
    { start: open, end: open, text: `\n${indent}  ${statement}\n${indent}` },
  ]);
}
