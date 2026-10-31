import type { ErrorContext } from './types';

// The same names @mfeflow/runtime uses. Telemetry listens on `window` instead of importing the
// runtime, because runtime plugins run before any shared module exists and must import nothing.
const EVENT = 'mfeflow:remote-error';
const CONNECTED = Symbol.for('mfeflow.telemetry.errors');

interface RemoteReport {
  mfe: string;
  where: string;
  message: string;
}

const isFunction = (value: unknown): value is () => void => typeof value === 'function';

function isRemoteReport(value: unknown): value is RemoteReport {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'mfe') === 'string' &&
    typeof Reflect.get(value, 'where') === 'string' &&
    typeof Reflect.get(value, 'message') === 'string'
  );
}

/**
 * Sends every remote failure to `report`: the ones already recorded in `globalThis.mfeflowReports`
 * and each one that follows. Connecting twice (StrictMode, a second copy) does not report twice.
 * Returns a function that disconnects.
 */
export function connectRemoteErrors(
  report: (error: unknown, context: ErrorContext) => void,
): () => void {
  if (typeof window === 'undefined' || isFunction(Reflect.get(window, CONNECTED))) {
    return () => {};
  }
  const forward = (item: unknown) => {
    if (!isRemoteReport(item)) return;
    report(new Error(item.message), { mfe: item.mfe, where: item.where });
  };
  const earlier: unknown = Reflect.get(globalThis, 'mfeflowReports');
  if (Array.isArray(earlier)) for (const item of earlier as unknown[]) forward(item);
  const onEvent = (event: Event) => {
    forward(event instanceof CustomEvent ? (event.detail as unknown) : undefined);
  };
  window.addEventListener(EVENT, onEvent);
  const disconnect = () => {
    window.removeEventListener(EVENT, onEvent);
    Reflect.deleteProperty(window, CONNECTED);
  };
  Reflect.set(window, CONNECTED, disconnect);
  return disconnect;
}

/** Disconnects whatever `connectRemoteErrors` connected on this page. */
export function disconnectRemoteErrors(): void {
  if (typeof window === 'undefined') return;
  const disconnect: unknown = Reflect.get(window, CONNECTED);
  if (isFunction(disconnect)) disconnect();
}
