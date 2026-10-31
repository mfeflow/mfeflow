import {
  isJSXElement,
  isJSXFragment,
  isJSXIdentifier,
  isReturnStatement,
  type Node,
} from '@babel/types';
import type { Literal, WrapProviderOp } from '@mfeflow/contracts';
import { MfeflowError } from '../errors.js';
import { addImport } from './add-import.js';
import {
  applyEdits,
  assertIdentifier,
  assertJsxAttribute,
  bodyOf,
  endOf,
  findAll,
  findFunction,
  indentAt,
  parseSource,
  startOf,
} from './ast.js';

function propSource(name: string, value: Literal): string {
  if (value === true) return name;
  if (typeof value === 'string' && !/["\\{}\n<>&]/.test(value)) return `${name}="${value}"`;
  return `${name}={${typeof value === 'string' ? JSON.stringify(value) : String(value)}}`;
}

function isJsx(node: Node | null | undefined): node is Node {
  return isJSXElement(node) || isJSXFragment(node);
}

/**
 * Wraps what the `Providers` component returns in `<Component …>`. The new
 * provider becomes the outermost one. Does nothing if the component is already used there.
 */
export function wrapProvider(source: string, file: string, op: WrapProviderOp): string {
  assertIdentifier(op.component, 'component');
  assertIdentifier(op.function, 'function');
  for (const key of Object.keys(op.props ?? {})) assertJsxAttribute(key);
  const withImport = addImport(source, file, {
    op: 'add-import',
    file: op.file,
    from: op.from,
    ...(op.defaultImport ? { default: op.component } : { named: [op.component] }),
  });
  const ast = parseSource(withImport, file);
  const name = op.function ?? 'Providers';
  const fn = findFunction(ast, name);
  if (!fn) throw new MfeflowError('E208', `${file} has no function "${name}"`);
  const body = bodyOf(fn);
  const returned = body ? body.body.find(isReturnStatement)?.argument : fn.body;
  if (!isJsx(returned)) {
    throw new MfeflowError('E208', `${name} in ${file} does not return JSX`);
  }

  const used = findAll(returned, (n) => isJSXIdentifier(n) && n.name === op.component).length > 0;
  if (used) return withImport;

  const start = startOf(returned);
  const end = endOf(returned);
  const indent = indentAt(withImport, start);
  const inner = withImport.slice(start, end).split('\n').join('\n  ');
  const props = Object.entries(op.props ?? {}).map(([k, v]) => ` ${propSource(k, v)}`);
  const wrapped = `<${op.component}${props.join('')}>\n${indent}  ${inner}\n${indent}</${op.component}>`;
  return applyEdits(withImport, [{ start, end, text: wrapped }]);
}
