import { isMap, isSeq, parseDocument } from 'yaml';
import type { AddWorkflowStepOp } from '@mfeflow/contracts';
import { MfeflowError } from '../errors.js';

const KEY_ORDER = ['name', 'id', 'if', 'uses', 'with', 'run', 'env'] as const;

function nameOf(item: unknown): unknown {
  return isMap(item) ? item.get('name') : undefined;
}

/** Adds a step to a job in a GitHub Actions workflow. Does nothing if a step with that name exists. */
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

  const ordered: Record<string, unknown> = {};
  for (const key of KEY_ORDER) {
    const value = op.step[key];
    if (value !== undefined) ordered[key] = value;
  }
  const node = doc.createNode(ordered);
  const anchor = op.after ? steps.items.findIndex((item) => nameOf(item) === op.after) : -1;
  if (op.after && anchor === -1) {
    throw new MfeflowError('E208', `${file} job "${op.job}" has no step named "${op.after}"`);
  }
  steps.items.splice(anchor === -1 ? steps.items.length : anchor + 1, 0, node);
  return doc.toString({ lineWidth: 0, flowCollectionPadding: false });
}
