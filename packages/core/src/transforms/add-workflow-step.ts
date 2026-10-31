import { isMap, isSeq, parseDocument, stringify, type YAMLSeq } from 'yaml';
import type { AddWorkflowStepOp } from '@mfeflow/contracts';
import { MfeflowError } from '../errors.js';
import { lineEnd, lineStart } from './ast.js';

const KEY_ORDER = ['name', 'id', 'if', 'uses', 'with', 'run', 'env'] as const;

function nameOf(item: unknown): unknown {
  return isMap(item) ? item.get('name') : undefined;
}

/** End of an item's text, without the blank lines a block scalar or the next node's gap may add. */
function contentEnd(source: string, end: number): number {
  let at = end;
  while (at > 0 && /\s/.test(source[at - 1] ?? '')) at -= 1;
  return at;
}

/**
 * Adds a step to a job in a GitHub Actions workflow. Does nothing if a step
 * with that name exists. The text is edited at the step list, in the list's
 * own style and indentation; the rest of the file is not re-serialized.
 */
export function addWorkflowStep(source: string, file: string, op: AddWorkflowStepOp): string {
  const doc = parseDocument(source);
  const first = doc.errors[0];
  if (first) {
    throw new MfeflowError('E208', `${file} is not valid YAML (${first.message})`, {
      cause: first,
    });
  }
  const steps = doc.getIn(['jobs', op.job, 'steps']);
  if (!isSeq(steps)) {
    throw new MfeflowError('E208', `${file} has no job "${op.job}" with steps`);
  }
  if (steps.items.some((item) => nameOf(item) === op.step.name)) return source;

  const anchor = op.after ? steps.items.findIndex((item) => nameOf(item) === op.after) : -1;
  if (op.after && anchor === -1) {
    throw new MfeflowError('E208', `${file} job "${op.job}" has no step named "${op.after}"`);
  }
  const ordered: Record<string, unknown> = {};
  for (const key of KEY_ORDER) {
    const value = op.step[key];
    if (value !== undefined) ordered[key] = value;
  }
  const edited = insertByRange(source, steps, anchor, ordered);
  if (edited !== undefined) return edited;
  const node = doc.createNode(ordered);
  steps.items.splice(anchor === -1 ? steps.items.length : anchor + 1, 0, node);
  return doc.toString({ lineWidth: 0, flowCollectionPadding: false });
}

/** The edited source, or undefined when the list's layout is not one this can edit in place. */
function insertByRange(
  source: string,
  steps: YAMLSeq,
  anchor: number,
  step: Record<string, unknown>,
): string | undefined {
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const at = anchor === -1 ? steps.items.length - 1 : anchor;
  const previous: unknown = steps.items[at];
  const range = isMap(previous) ? previous.range : undefined;

  if (steps.flow) {
    const flow = stringify(step, { collectionStyle: 'flow', lineWidth: 0 }).trim();
    const listStart = steps.range?.[0];
    if (!range) {
      return listStart === undefined || steps.items.length > 0
        ? undefined
        : `${source.slice(0, listStart + 1)}${flow}${source.slice(listStart + 1)}`;
    }
    const end = contentEnd(source, range[1]);
    return `${source.slice(0, end)}, ${flow}${source.slice(end)}`;
  }

  if (!range || !isMap(previous)) return undefined;
  const dash = source.lastIndexOf('-', range[0]);
  const indent = source.slice(lineStart(source, dash), dash);
  if (dash === -1 || !/^[ \t]*$/.test(indent)) return undefined;
  const body = previous.flow
    ? [stringify(step, { collectionStyle: 'flow', lineWidth: 0 }).trim()]
    : stringify(step, { lineWidth: 0 }).trimEnd().split('\n');
  const text = body.map((line, i) => `${indent}${i === 0 ? '- ' : '  '}${line}`).join(eol);
  const end = contentEnd(source, range[1]);
  const insertAt = lineEnd(source, end);
  const lineBreak = source[insertAt - 1] === '\r' ? insertAt - 1 : insertAt;
  return `${source.slice(0, lineBreak)}${eol}${text}${source.slice(lineBreak)}`;
}
