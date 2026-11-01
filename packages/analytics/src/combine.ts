import type { AnalyticsProvider } from './types';
import { warnOnce } from './validate';

const members = new WeakMap<AnalyticsProvider, readonly AnalyticsProvider[]>();

/** The providers a combined provider sends to (itself, if it is not a combination). */
export function partsOf(provider: AnalyticsProvider): readonly AnalyticsProvider[] {
  return members.get(provider) ?? [provider];
}

/**
 * One provider that forwards every call to all of `providers`, in order. A provider that throws is
 * reported once and skipped for that call, so a failing tag cannot stop the others.
 */
export function combineProviders(...providers: AnalyticsProvider[]): AnalyticsProvider {
  const parts = providers.flatMap(partsOf);
  const each = (what: string, call: (provider: AnalyticsProvider) => void) => {
    for (const part of parts) {
      try {
        call(part);
      } catch (error) {
        warnOnce(
          `${part.name}: ${what} failed (${error instanceof Error ? error.message : 'unknown error'})`,
        );
      }
    }
  };
  const combined: AnalyticsProvider = {
    name: parts.map((p) => p.name).join('+'),
    init: (consent) => {
      each('init', (p) => {
        p.init(consent);
      });
    },
    track: (event, params) => {
      each('track', (p) => {
        p.track(event, params);
      });
    },
    page: (path, params) => {
      each('page', (p) => {
        p.page(path, params);
      });
    },
    identify: (userId, traits) => {
      each('identify', (p) => {
        p.identify(userId, traits);
      });
    },
    setConsent: (update) => {
      each('setConsent', (p) => {
        p.setConsent(update);
      });
    },
  };
  members.set(combined, parts);
  return combined;
}
