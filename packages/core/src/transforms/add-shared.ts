import { isStringLiteral } from '@babel/types';
import type { AddSharedOp } from '@mfeflow/contracts';
import { MfeflowError } from '../errors';
import {
  appendItem,
  applyEdits,
  assertIdentifier,
  detectQuote,
  findArray,
  parseSource,
  quote,
} from './ast';

/** Adds a package to the singletons array. Does nothing if it is already listed. */
export function addShared(source: string, file: string, op: AddSharedOp): string {
  assertIdentifier(op.list, 'list');
  const ast = parseSource(source, file);
  const list = op.list ?? 'singletons';
  const array = findArray(ast, list);
  if (!array) throw new MfeflowError('E208', `${file} has no array named "${list}"`);
  const present = array.elements.some((e) => isStringLiteral(e) && e.value === op.name);
  if (present) return source;
  const items = array.elements.filter((e) => e !== null);
  return applyEdits(
    source,
    appendItem(source, array, items, quote(op.name, detectQuote(source, ast))),
  );
}
