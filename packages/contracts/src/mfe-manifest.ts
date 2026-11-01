import { EXPOSE, ROUTE } from './entry';
import { Checker, isObj, type Issue } from './validate';

export { EXPOSE, ROUTE };

/** `mfe.json`: who owns a micro-frontend and what it promises. */
export interface MfeManifest {
  $schema?: string;
  /** Module Federation name: lowercase letters, digits, `_`. */
  name: string;
  /** Owning team, e.g. `team-payments`. Alerts route here. */
  owner: string;
  /** Slack channel, email or URL. */
  contact?: string;
  /** Shells this remote runs in. Empty for a shell's own manifest. */
  shells: string[];
  /** Routes the remote claims, e.g. `/cart` or `/checkout/*`. */
  routes: string[];
  /** Exposed modules, e.g. `./App`. */
  exposes: string[];
  events?: { publishes: string[]; consumes: string[] };
  analyticsEvents?: string[];
  budgets?: { initialJsKb?: number; lcpMs?: number };
  /** Platform package ranges, e.g. `{ "react": "^19", "@mfeflow/runtime": "^0.2" }`. */
  platform?: Record<string, string>;
}

/**
 * Lowercase words of letters and digits, joined by single underscores. A name never ends
 * in `_` and `_` is never followed by a digit, so `cart_` and `cart`, or `a__b` and `a_b`,
 * cannot become the same component or global name.
 */
export const MFE_NAME = /^[a-z][a-z0-9]*(?:_[a-z][a-z0-9]*)*$/;
/** `<domain>.<event>.v<major>`, e.g. `cart.item-added.v1`. The same pattern `@mfeflow/event-bus` checks names against. */
export const EVENT_NAME = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+\.v[1-9][0-9]*$/;
/** `<domain>_<object>_<action>`, e.g. `checkout_order_completed`. */
export const ANALYTICS_EVENT = /^[a-z][a-z0-9]*(_[a-z0-9]+)+$/;

export function validateMfeManifest(value: unknown): Issue[] {
  const c = new Checker();
  if (!isObj(value)) {
    c.add('', 'must be an object');
    return c.issues;
  }
  c.string(value, 'name', '', {
    pattern: MFE_NAME,
    hint: 'use lowercase words of letters and digits joined by single _ (a Module Federation name)',
  });
  c.string(value, 'owner', '');
  c.string(value, 'contact', '', { required: false });
  c.stringArray(value, 'shells', '', { pattern: MFE_NAME, hint: 'must be a shell name' });
  const routes = c.stringArray(value, 'routes', '', {
    pattern: ROUTE,
    hint: 'must start with "/"',
  });
  if (new Set(routes).size !== routes.length) c.add('routes', 'has duplicates');
  c.stringArray(value, 'exposes', '', { pattern: EXPOSE, hint: 'must look like "./App"' });
  const events = c.object(value, 'events', '', false);
  if (events) {
    c.stringArray(events, 'publishes', 'events', {
      pattern: EVENT_NAME,
      hint: 'must look like "cart.item-added.v1"',
    });
    c.stringArray(events, 'consumes', 'events', {
      pattern: EVENT_NAME,
      hint: 'must look like "cart.item-added.v1"',
    });
  }
  c.stringArray(value, 'analyticsEvents', '', {
    required: false,
    pattern: ANALYTICS_EVENT,
    hint: 'must look like "checkout_order_completed"',
  });
  const budgets = c.object(value, 'budgets', '', false);
  if (budgets) {
    c.number(budgets, 'initialJsKb', 'budgets', { required: false, min: 1 });
    c.number(budgets, 'lcpMs', 'budgets', { required: false, min: 1 });
  }
  const platform = c.object(value, 'platform', '', false);
  if (platform) {
    for (const [pkg, range] of Object.entries(platform)) {
      if (typeof range !== 'string') c.add(`platform.${pkg}`, 'must be a semver range string');
    }
  }
  return c.issues;
}

export function isMfeManifest(value: unknown): value is MfeManifest {
  return validateMfeManifest(value).length === 0;
}
