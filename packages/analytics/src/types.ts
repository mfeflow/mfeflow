export type EventParams = Record<string, unknown>;

/** The four Consent Mode v2 signals. */
export type ConsentKey = 'ad_storage' | 'analytics_storage' | 'ad_user_data' | 'ad_personalization';

export type ConsentValue = 'granted' | 'denied';

export type ConsentUpdate = Partial<Record<ConsentKey, ConsentValue>>;

export const CONSENT_KEYS: readonly ConsentKey[] = [
  'ad_storage',
  'analytics_storage',
  'ad_user_data',
  'ad_personalization',
];

export interface AnalyticsProvider {
  readonly name: string;
  /** Called once. `consent` is the choice the visitor made on an earlier visit, if any. */
  init(consent: ConsentUpdate): void;
  track(event: string, params: EventParams): void;
  page(path: string, params: EventParams): void;
  identify(userId: string, traits: EventParams): void;
  setConsent(update: ConsentUpdate): void;
}
