import type { AnalyticsProvider, ConsentUpdate, EventParams } from './types';

export const noopProvider: AnalyticsProvider = {
  name: 'noop',
  init() {},
  track() {},
  page() {},
  identify() {},
  setConsent() {},
};

export type RecordedCall =
  | { type: 'init'; consent: ConsentUpdate }
  | { type: 'track'; event: string; params: EventParams }
  | { type: 'page'; path: string; params: EventParams }
  | { type: 'identify'; userId: string; traits: EventParams }
  | { type: 'consent'; update: ConsentUpdate };

/** A provider for tests: it sends nothing and remembers every call in order. */
export function createRecordingProvider(): AnalyticsProvider & { calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  return {
    name: 'recording',
    calls,
    init(consent) {
      calls.push({ type: 'init', consent });
    },
    track(event, params) {
      calls.push({ type: 'track', event, params });
    },
    page(path, params) {
      calls.push({ type: 'page', path, params });
    },
    identify(userId, traits) {
      calls.push({ type: 'identify', userId, traits });
    },
    setConsent(update) {
      calls.push({ type: 'consent', update });
    },
  };
}
