import {
  isCallExpression,
  isIdentifier,
  isMemberExpression,
  type Node,
  type Statement,
} from '@babel/types';
import type { AddBootStepOp } from '@mfeflow/contracts';
import { MfeflowError } from '../errors';
import { addImport } from './add-import';
import {
  applyEdits,
  assertIdentifier,
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
} from './ast';

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
  assertIdentifier(op.call, 'call');
  assertIdentifier(op.function, 'function');
  assertIdentifier(op.before, 'before');
  assertIdentifier(op.after, 'after');
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

  const wantsAwait = op.await !== false;
  if (wantsAwait && !fn.async) {
    throw new MfeflowError(
      'E208',
      `${name} in ${file} is not async, so it cannot await "${op.call}"; make it async or set "await": false`,
    );
  }

  const q = detectQuote(withImport, ast);
  const args = (op.args ?? []).map((a) => literalSource(a, q)).join(', ');
  const statement = `${wantsAwait ? 'await ' : ''}${op.call}(${args});`;
  const last = body.body.at(-1);
  const ownsLine = (offset: number) =>
    withImport.slice(lineStart(withImport, offset), offset).trim() === '';

  if (anchor && !op.after) {
    const start = startOf(anchor);
    if (!ownsLine(start)) {
      return applyEdits(withImport, [{ start, end: start, text: `${statement} ` }]);
    }
    const at = lineStart(withImport, start);
    return applyEdits(withImport, [
      { start: at, end: at, text: `${indentAt(withImport, start)}${statement}\n` },
    ]);
  }
  const after = anchor ?? last;
  if (after) {
    const end = endOf(after);
    const rest = withImport.slice(end, lineEnd(withImport, end)).trim();
    if (rest !== '' && !rest.startsWith('//')) {
      return applyEdits(withImport, [{ start: end, end, text: ` ${statement}` }]);
    }
    const at = lineEnd(withImport, end);
    const base = indentAt(withImport, startOf(after));
    const indent = ownsLine(startOf(after)) ? base : `${base}  `;
    return applyEdits(withImport, [{ start: at, end: at, text: `\n${indent}${statement}` }]);
  }
  const open = startOf(body) + 1;
  const indent = indentAt(withImport, startOf(body));
  return applyEdits(withImport, [
    { start: open, end: open, text: `\n${indent}  ${statement}\n${indent}` },
  ]);
}
