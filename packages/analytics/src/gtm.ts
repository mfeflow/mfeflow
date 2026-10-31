import {
  CONSENT_KEYS,
  type AnalyticsProvider,
  type ConsentUpdate,
  type EventParams,
} from './types';
import { warnOnce } from './validate';

export interface GtmOptions {
  /** The container, e.g. `GTM-ABC123`. From the runtime config, never baked into the bundle. */
  containerId: string;
  /** Default `dataLayer`. */
  dataLayerName?: string | undefined;
  /** Default Google's `gtm.js`. Tests and server-side containers point it elsewhere. */
  scriptUrl?: string | undefined;
  /** Consent before the visitor chooses. Default: every signal `denied`. */
  consentDefaults?: ConsentUpdate | undefined;
  /** How long tags wait for a consent update, in milliseconds. Default 500. */
  waitForUpdate?: number | undefined;
  /** Send `user_id` on `identify`. Off by default; traits are never sent. */
  sendUserId?: boolean | undefined;
  /** Send parameters that look like personal data. Off by default: they are dropped. */
  allowPii?: boolean | undefined;
}

const CONTAINER_ID = /^GTM-[A-Z0-9]{4,12}$/;
const PII_KEY =
  /^(e-?mail|phone|mobile|first_?name|last_?name|full_?name|name|address|ssn|dob|birth_?date|password|token)$/i;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;

export const GTM_SCRIPT_URL = 'https://www.googletagmanager.com/gtm.js';
export const GTM_SCRIPT_ATTRIBUTE = 'data-mfeflow-gtm';

type Layer = unknown[];

function layerOf(name: string): Layer {
  const existing: unknown = Reflect.get(globalThis, name);
  if (Array.isArray(existing)) return existing;
  const fresh: Layer = [];
  Reflect.set(globalThis, name, fresh);
  return fresh;
}

/** Drops personal data from event parameters, and says what it dropped. */
export function scrubPii(params: EventParams): { clean: EventParams; dropped: string[] } {
  const clean: EventParams = {};
  const dropped: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (PII_KEY.test(key) || (typeof value === 'string' && EMAIL.test(value))) dropped.push(key);
    else clean[key] = value;
  }
  return { clean, dropped };
}

/**
 * Google Tag Manager with Consent Mode v2. `init` pushes the consent defaults to the data layer
 * before it adds the `gtm.js` script, so tags never run ahead of the visitor's choice. A second
 * `init` for the same container (a second provider, StrictMode) finds the script tag and changes nothing.
 */
export function createGtmProvider(options: GtmOptions): AnalyticsProvider {
  const { containerId } = options;
  if (!CONTAINER_ID.test(containerId)) {
    throw new Error(`"${containerId}" is not a Tag Manager container id (expected GTM-XXXXXXX)`);
  }
  const layerName = options.dataLayerName ?? 'dataLayer';
  const layer = (): Layer => layerOf(layerName);
  // GTM only understands the `arguments` object gtag pushes, not an array of the same values.
  function gtag(..._args: unknown[]): void {
    // oxlint-disable-next-line prefer-rest-params -- see above
    layer().push(arguments);
  }
  const defaults: Record<string, unknown> = {};
  for (const key of CONSENT_KEYS) defaults[key] = options.consentDefaults?.[key] ?? 'denied';
  defaults['wait_for_update'] = options.waitForUpdate ?? 500;

  return {
    name: 'gtm',
    init(consent) {
      const selector = `script[${GTM_SCRIPT_ATTRIBUTE}="${containerId}"]`;
      if (document.querySelector(selector)) return;
      gtag('consent', 'default', defaults);
      if (Object.keys(consent).length > 0) gtag('consent', 'update', consent);
      layer().push({ 'gtm.start': Date.now(), event: 'gtm.js' });
      const script = document.createElement('script');
      script.async = true;
      script.setAttribute(GTM_SCRIPT_ATTRIBUTE, containerId);
      const url = new URL(options.scriptUrl ?? GTM_SCRIPT_URL, location.href);
      url.searchParams.set('id', containerId);
      if (layerName !== 'dataLayer') url.searchParams.set('l', layerName);
      script.src = url.href;
      document.head.append(script);
    },
    track(event, params) {
      const { clean, dropped } =
        options.allowPii === true ? { clean: params, dropped: [] } : scrubPii(params);
      if (dropped.length > 0) {
        warnOnce(`"${event}": dropped ${dropped.join(', ')} because it looks like personal data`);
      }
      layer().push({ ...clean, event });
    },
    page(path, params) {
      layer().push({
        ...params,
        event: 'page_view',
        page_path: path,
        page_location: location.origin + path,
        page_title: document.title,
      });
    },
    identify(userId) {
      if (options.sendUserId === true) layer().push({ event: 'identify', user_id: userId });
    },
    setConsent(update) {
      if (Object.keys(update).length > 0) gtag('consent', 'update', update);
    },
  };
}
