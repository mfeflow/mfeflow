import { isMfeflowError, MfeflowError } from './errors.js';

/** Awaits a promise that must reject with an MfeflowError and returns it. */
export async function rejection(promise: Promise<unknown>): Promise<MfeflowError> {
  try {
    await promise;
  } catch (error) {
    if (isMfeflowError(error)) return error;
    throw error;
  }
  throw new Error('expected the promise to reject');
}

/** Calls `fn`, which must throw an MfeflowError, and returns it. */
export function thrown(fn: () => unknown): MfeflowError {
  try {
    fn();
  } catch (error) {
    if (isMfeflowError(error)) return error;
    throw error;
  }
  throw new Error('expected the call to throw');
}
