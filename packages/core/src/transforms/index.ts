import type { TransformOp } from '@mfeflow/contracts';
import { MfeflowError } from '../errors.js';
import { addBootStep } from './add-boot-step.js';
import { addEnvKey } from './add-env-key.js';
import { addImport } from './add-import.js';
import { addRoute } from './add-route.js';
import { addShared } from './add-shared.js';
import { addWorkflowStep } from './add-workflow-step.js';
import { wrapProvider } from './wrap-provider.js';

export { addBootStep, addEnvKey, addImport, addRoute, addShared, addWorkflowStep, wrapProvider };

/**
 * Runs one built-in op on a file's source and returns the new source. Pure, and
 * idempotent: when the change is already there the input comes back untouched.
 * `file` is only used to pick the parser and in error messages.
 */
export function applyTransform(source: string, file: string, op: TransformOp): string {
  switch (op.op) {
    case 'add-import':
      return addImport(source, file, op);
    case 'wrap-provider':
      return wrapProvider(source, file, op);
    case 'add-shared':
      return addShared(source, file, op);
    case 'add-boot-step':
      return addBootStep(source, file, op);
    case 'add-env-key':
      return addEnvKey(source, file, op);
    case 'add-route':
      return addRoute(source, file, op);
    case 'add-workflow-step':
      return addWorkflowStep(source, file, op);
    default:
      throw new MfeflowError('E204', JSON.stringify(Reflect.get(op, 'op')));
  }
}
