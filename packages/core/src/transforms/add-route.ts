import { isIdentifier, isObjectExpression, isObjectProperty, isStringLiteral } from '@babel/types';
import type { AddRouteOp } from '@mfeflow/contracts';
import { MfeflowError } from '../errors.js';
import { addImport } from './add-import.js';
import { appendItem, applyEdits, detectQuote, findArray, parseSource, quote } from './ast.js';

/** Adds `{ path, Component }` to the routes array. Does nothing if the path is already routed. */
export function addRoute(source: string, file: string, op: AddRouteOp): string {
  const withImport = addImport(source, file, {
    op: 'add-import',
    file: op.file,
    from: op.from,
    ...(op.defaultImport ? { default: op.component } : { named: [op.component] }),
  });
  const ast = parseSource(withImport, file);
  const list = op.routes ?? 'routes';
  const array = findArray(ast, list);
  if (!array) throw new MfeflowError('E208', `${file} has no array named "${list}"`);

  const routed = array.elements.some(
    (e) =>
      isObjectExpression(e) &&
      e.properties.some(
        (p) =>
          isObjectProperty(p) &&
          isIdentifier(p.key) &&
          p.key.name === 'path' &&
          isStringLiteral(p.value) &&
          p.value.value === op.path,
      ),
  );
  if (routed) return withImport;

  const q = detectQuote(withImport, ast);
  const entry = `{ path: ${quote(op.path, q)}, Component: ${op.component} }`;
  const items = array.elements.filter((e) => e !== null);
  return applyEdits(withImport, appendItem(withImport, array, items, entry));
}
