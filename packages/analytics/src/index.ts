/**
 * Every event the platform knows, with its parameters. Empty here: each remote adds its own
 * by declaration merging, so `tracker.track('add_to_cart', { sku })` is checked end to end.
 *
 *   declare module '@mfeflow/analytics' {
 *     interface AnalyticsEvents {
 *       add_to_cart: { sku: string };
 *       cart_viewed: undefined;
 *     }
 *   }
 */
// oxlint-disable-next-line typescript/no-empty-interface -- merged by each remote
export interface AnalyticsEvents {}

export {
  getConsent,
  hasConsentChoice,
  identify,
  initAnalytics,
  isAnalyticsReady,
  page,
  pageOnce,
  providerName,
  resetAnalyticsForTests,
  subscribeConsent,
  track,
  updateConsent,
} from './core';
export { CONSENT_STORAGE_KEY, DENY_ALL, GRANT_ALL, cleanConsent } from './consent';
export { createRecordingProvider, noopProvider, type RecordedCall } from './noop';
export {
  createTracker,
  type EventName,
  type ParamsArg,
  type Tracker,
  type TrackerOptions,
} from './tracker';
export {
  CONSENT_KEYS,
  type AnalyticsProvider,
  type ConsentKey,
  type ConsentUpdate,
  type ConsentValue,
  type EventParams,
} from './types';
export { resetWarningsForTests } from './validate';
