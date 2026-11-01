import type { AnalyticsProvider, ConsentUpdate } from './types';

export interface ClarityOptions {
  /** The Clarity project id, like `k3x9m2abcd`. From the runtime config, never baked into the bundle. */
  projectId: string;
  /** Default Clarity's own `https://www.clarity.ms/tag/`. Tests point it elsewhere. */
  scriptUrl?: string | undefined;
  /** Send the id given to `identify` as Clarity's custom user id. Off by default; traits are never sent. */
  sendUserId?: boolean | undefined;
}

const PROJECT_ID = /^[a-z0-9]{8,12}$/;
export const CLARITY_SCRIPT_URL = 'https://www.clarity.ms/tag/';
export const CLARITY_SCRIPT_ATTRIBUTE = 'data-mfeflow-clarity';

type Clarity = ((...args: unknown[]) => void) & { q?: unknown[] };

const isClarity = (value: unknown): value is Clarity => typeof value === 'function';

function clarityFunction(): Clarity {
  const existing: unknown = Reflect.get(globalThis, 'clarity');
  if (isClarity(existing)) return existing;
  // Clarity's loader replays the `arguments` objects it finds in `q`, the same way its own snippet queues them.
  const queue: Clarity = function queued() {
    // oxlint-disable-next-line prefer-rest-params -- see above
    (queue.q ??= []).push(arguments);
  };
  Reflect.set(globalThis, 'clarity', queue);
  return queue;
}

/**
 * Microsoft Clarity behind the analytics interface, gated on consent. Nothing is requested, and no cookie is
 * set, until `analytics_storage` is `granted`: the script is added on that choice (now, or on a later visit
 * when the stored consent arrives in `init`). A later `denied` tells Clarity to stop and clear its cookies.
 * Until then every call is dropped, never kept for later.
 */
export function createClarityProvider(options: ClarityOptions): AnalyticsProvider {
  const { projectId } = options;
  if (!PROJECT_ID.test(projectId)) {
    throw new Error(
      `"${projectId}" is not a Clarity project id (8 to 12 lowercase letters and digits)`,
    );
  }
  let consent: ConsentUpdate = {};
  let started = false;

  const sendConsent = () => {
    clarityFunction()('consentv2', {
      ad_Storage: consent.ad_storage ?? 'denied',
      analytics_Storage: consent.analytics_storage ?? 'denied',
    });
  };

  const start = () => {
    if (started) return;
    started = true;
    const selector = `script[${CLARITY_SCRIPT_ATTRIBUTE}="${projectId}"]`;
    clarityFunction();
    sendConsent();
    if (document.querySelector(selector)) return;
    const script = document.createElement('script');
    script.async = true;
    script.setAttribute(CLARITY_SCRIPT_ATTRIBUTE, projectId);
    const base = options.scriptUrl ?? CLARITY_SCRIPT_URL;
    script.src = new URL(projectId, base.endsWith('/') ? base : `${base}/`).href;
    document.head.append(script);
  };

  const apply = (update: ConsentUpdate) => {
    consent = { ...consent, ...update };
    if (started) sendConsent();
    else if (consent.analytics_storage === 'granted') start();
  };

  return {
    name: 'clarity',
    init(stored) {
      apply(stored);
    },
    track(event) {
      if (started && consent.analytics_storage === 'granted') clarityFunction()('event', event);
    },
    page(path) {
      if (started && consent.analytics_storage === 'granted')
        clarityFunction()('set', 'page_path', path);
    },
    identify(userId) {
      if (options.sendUserId === true && started && consent.analytics_storage === 'granted') {
        clarityFunction()('identify', userId);
      }
    },
    setConsent(update) {
      apply(update);
    },
  };
}
