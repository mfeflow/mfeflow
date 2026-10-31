import { page, track } from './core';
import type { AnalyticsEvents } from './index';
import type { EventParams } from './types';
import { eventProblem, isDev, warnOnce } from './validate';

const isParams = (value: unknown): value is EventParams =>
  typeof value === 'object' && value !== null;

export type EventName = Extract<keyof AnalyticsEvents, string>;

/** Events that take no parameters are called as `track('name')`; the rest as `track('name', { … })`. */
export type ParamsArg<E extends EventName> = AnalyticsEvents[E] extends undefined | void
  ? [params?: undefined]
  : [params: AnalyticsEvents[E]];

export interface TrackerOptions {
  /** Version of the remote, sent as `mfe_version`. */
  mfeVersion?: string | undefined;
  /** Every event this remote sends. In development, any other name logs a warning once. */
  events?: readonly EventName[] | undefined;
}

export interface Tracker {
  /** The micro-frontend this tracker belongs to. */
  readonly mfe: string;
  track<E extends EventName>(event: E, ...params: ParamsArg<E>): void;
  page(path: string): void;
}

/**
 * A tracker for one micro-frontend. Every event it sends carries `mfe_name` and `mfe_version`
 * (`null` when unknown). They are flat and always both set: the data layer merges nested objects,
 * and an object or a missing key would leave the previous remote's value on this remote's event.
 */
export function createTracker(mfeName: string, options: TrackerOptions = {}): Tracker {
  const known = options.events ? new Set<string>(options.events) : undefined;
  const stamp = (params?: EventParams): EventParams => ({
    ...params,
    mfe_name: mfeName,
    mfe_version: options.mfeVersion ?? null,
  });
  return {
    mfe: mfeName,
    track(event, ...rest) {
      if (isDev()) {
        const problem = eventProblem(mfeName, event, known);
        if (problem) warnOnce(problem);
      }
      const params: unknown = rest[0];
      track(event, stamp(isParams(params) ? params : undefined));
    },
    page(path) {
      page(path, stamp());
    },
  };
}
