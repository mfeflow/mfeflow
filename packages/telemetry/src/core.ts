import { connectRemoteErrors, disconnectRemoteErrors } from './errors';
import { noopProvider } from './noop';
import { MfeTracer } from './tracer';
import type { ErrorContext, TelemetryProvider, Tracer, WebVitalMetric } from './types';

const KEY = Symbol.for('mfeflow.telemetry');
const QUEUE_LIMIT = 50;

type Call = (provider: TelemetryProvider) => void;

interface State {
  provider: TelemetryProvider;
  /** True once a provider was chosen, even if it is still loading. */
  started: boolean;
  queue: Call[];
  /** Settles when the provider is ready (or failed to load, in which case the noop stays). */
  ready: Promise<void>;
}

function isState(value: unknown): value is State {
  return typeof value === 'object' && value !== null && 'queue' in value && 'provider' in value;
}

// On globalThis so that a second copy of this package still sees the one provider.
function state(): State {
  const existing: unknown = Reflect.get(globalThis, KEY);
  if (isState(existing)) return existing;
  const fresh: State = {
    provider: noopProvider,
    started: false,
    queue: [],
    ready: Promise.resolve(),
  };
  Reflect.set(globalThis, KEY, fresh);
  return fresh;
}

export type ProviderSource = TelemetryProvider | (() => Promise<TelemetryProvider>);

export interface InitOptions {
  /**
   * When to load a provider that comes from a function. `idle` (default) waits for the page to
   * finish loading, the first paint and an idle browser, so the SDK never competes with first render.
   * `now` loads it immediately.
   */
  when?: 'idle' | 'now';
  /** Called when the provider fails to load or start. The noop provider stays in place. */
  onError?: (error: unknown) => void;
}

/** A hidden tab never paints, so it must not wait for a paint forever. */
const PAINT_WAIT_MS = 3000;

/** Resolves after the page has loaded, the frame that follows has painted, and the browser is idle. */
function afterFirstPaint(): Promise<void> {
  return new Promise((resolve) => {
    let started = false;
    const idle = () => {
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(
          () => {
            resolve();
          },
          { timeout: 2000 },
        );
      } else setTimeout(resolve, 200);
    };
    const afterPaint = () => {
      if (started) return;
      started = true;
      idle();
    };
    const painted = () => {
      // requestAnimationFrame runs just before the paint; the timer runs after it.
      requestAnimationFrame(() => {
        setTimeout(afterPaint, 0);
      });
      setTimeout(afterPaint, PAINT_WAIT_MS);
    };
    if (document.readyState === 'complete') painted();
    else addEventListener('load', painted, { once: true });
  });
}

/**
 * Starts telemetry. Only the shell calls this, and only once: later calls return false.
 * A provider given as a function is loaded after first render; `reportError` and
 * `recordWebVitals` calls made until it is ready are kept (the last 50) and replayed, including the
 * remote failures `@mfeflow/runtime` reported before this ran. Spans started before that are not recorded.
 */
export function initTelemetry(source: ProviderSource, options: InitOptions = {}): boolean {
  const s = state();
  if (s.started) return false;
  s.started = true;
  connectRemoteErrors(reportError);
  const activate = async (): Promise<void> => {
    try {
      const provider = typeof source === 'function' ? await source() : source;
      await provider.init();
      s.provider = provider;
      for (const call of s.queue.splice(0)) call(provider);
    } catch (error) {
      s.queue.length = 0;
      options.onError?.(error);
    }
  };
  const start =
    typeof source === 'function' && options.when !== 'now'
      ? afterFirstPaint().then(activate)
      : activate();
  s.ready = start;
  return true;
}

/** Resolves when the provider is ready, or has failed to load. */
export function telemetryReady(): Promise<void> {
  return state().ready;
}

export function isTelemetryReady(): boolean {
  return state().provider !== noopProvider;
}

/** Sends whatever the provider has buffered. For tests and `pagehide` handlers. */
export async function flushTelemetry(): Promise<void> {
  await state().provider.flush?.();
}

function send(call: Call): void {
  const s = state();
  if (s.provider !== noopProvider) {
    call(s.provider);
    return;
  }
  if (s.queue.length >= QUEUE_LIMIT) s.queue.shift();
  s.queue.push(call);
}

/**
 * The tracer for one remote. Every span it starts carries `mfe.name`. Take it once at import time:
 * it follows the provider, so it records as soon as telemetry is ready.
 */
export function getTracer(mfeName: string, mfeVersion?: string): Tracer {
  return new MfeTracer(() => state().provider.getTracer(mfeName), {
    'mfe.name': mfeName,
    ...(mfeVersion === undefined ? {} : { 'mfe.version': mfeVersion }),
  });
}

export function reportError(error: unknown, context: ErrorContext): void {
  send((p) => {
    p.reportError(error, context);
  });
}

export function recordWebVitals(metric: WebVitalMetric): void {
  send((p) => {
    p.recordWebVitals(metric);
  });
}

/** Only for tests. */
export function resetTelemetryForTests(): void {
  disconnectRemoteErrors();
  Reflect.deleteProperty(globalThis, KEY);
}
