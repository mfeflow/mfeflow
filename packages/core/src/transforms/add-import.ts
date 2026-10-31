import {
  isImportDeclaration,
  isImportDefaultSpecifier,
  isImportNamespaceSpecifier,
  isImportSpecifier,
  type File,
} from '@babel/types';
import type { AddImportOp } from '@mfeflow/contracts';
import {
  applyEdits,
  assertIdentifier,
  endOf,
  indentAt,
  parseSource,
  quote,
  startOf,
} from './ast.js';

/** Puts a statement after the last import, after directives or a `#!` line, or at the top. */
export function insertStatement(source: string, ast: File, statement: string): string {
  const last = ast.program.body.findLast(isImportDeclaration);
  if (last) {
    const at = endOf(last);
    return `${source.slice(0, at)}\n${statement}${source.slice(at)}`;
  }
  const directive = ast.program.directives.at(-1);
  if (directive) {
    const at = endOf(directive);
    return `${source.slice(0, at)}\n\n${statement}${source.slice(at)}`;
  }
  const interpreter = ast.program.interpreter;
  if (interpreter) {
    const at = endOf(interpreter);
    const rest = source.slice(at);
    const spacer = rest === '' ? '\n' : rest.trim() === '' ? '' : '\n';
    return `${source.slice(0, at)}\n${statement}${spacer}${rest}`;
  }
  return `${statement}\n${source.startsWith('\n') || source === '' ? '' : '\n'}${source}`;
}

/** Adds an import, merging into an existing import from the same module. Does nothing if it is already there. */
export function addImport(source: string, file: string, op: AddImportOp): string {
  for (const name of op.named ?? []) assertIdentifier(name, 'import name');
  assertIdentifier(op.default, 'default import');
  assertIdentifier(op.namespace, 'namespace import');
  const ast = parseSource(source, file);
  const imports = ast.program.body.filter(isImportDeclaration);
  const kind = op.typeOnly ? 'type' : 'value';
  const same = imports.filter(
    (d) => d.source.value === op.from && (d.importKind ?? 'value') === kind,
  );
  const specifiers = same.flatMap((d) => d.specifiers);
  const q = imports[0] && source[startOf(imports[0].source)] === '"' ? '"' : "'";
  const type = op.typeOnly ? 'type ' : '';

  if (!op.named?.length && !op.default && !op.namespace) {
    if (imports.some((d) => d.source.value === op.from)) return source;
    return insertStatement(source, ast, `import ${quote(op.from, q)};`);
  }

  const needDefault =
    op.default !== undefined &&
    !specifiers.some((s) => isImportDefaultSpecifier(s) && s.local.name === op.default);
  const needNamespace =
    op.namespace !== undefined &&
    !specifiers.some((s) => isImportNamespaceSpecifier(s) && s.local.name === op.namespace);
  let needNamed = (op.named ?? []).filter(
    (name) => !specifiers.some((s) => isImportSpecifier(s) && s.local.name === name),
  );
  if (!needDefault && !needNamespace && needNamed.length === 0) return source;

  let merged = source;
  const target = same.find((d) => d.specifiers.some(isImportSpecifier));
  const lastNamed = target?.specifiers.findLast(isImportSpecifier);
  if (target && lastNamed && needNamed.length > 0) {
    const multiline = source.slice(startOf(target), endOf(target)).includes('\n');
    const sep = multiline ? `,\n${indentAt(source, startOf(lastNamed))}` : ', ';
    merged = applyEdits(source, [
      {
        start: endOf(lastNamed),
        end: endOf(lastNamed),
        text: needNamed.map((n) => `${sep}${n}`).join(''),
      },
    ]);
    needNamed = [];
  }

  const clauses: string[] = [];
  const named = needNamed.length > 0 ? `{ ${needNamed.join(', ')} }` : undefined;
  if (needDefault && named && !op.typeOnly) clauses.push(`${op.default}, ${named}`);
  else {
    if (needDefault) clauses.push(op.default ?? '');
    if (named) clauses.push(named);
  }
  if (needNamespace) clauses.push(`* as ${op.namespace}`);
  if (clauses.length === 0) return merged;
  const statements = clauses.map((c) => `import ${type}${c} from ${quote(op.from, q)};`).join('\n');
  return insertStatement(merged, merged === source ? ast : parseSource(merged, file), statements);
}
