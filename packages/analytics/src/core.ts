import {
  CONSENT_STORAGE_KEY,
  cleanConsent,
  readStoredConsent,
  writeStoredConsent,
} from './consent';
import { noopProvider } from './noop';
import type { AnalyticsProvider, ConsentUpdate, EventParams } from './types';

const KEY = Symbol.for('mfeflow.analytics');
const QUEUE_LIMIT = 100;

type Call = (provider: AnalyticsProvider) => void;

interface State {
  provider: AnalyticsProvider | undefined;
  queue: Call[];
  consent: ConsentUpdate;
  listeners: Set<() => void>;
  lastPage: string | undefined;
}

function isState(value: unknown): value is State {
  return typeof value === 'object' && value !== null && 'queue' in value && 'listeners' in value;
}

// Kept on globalThis, not in a module variable: a second copy of this package (a missing
// singleton share) then still talks to the one provider instead of starting its own.
function state(): State {
  const existing: unknown = Reflect.get(globalThis, KEY);
  if (isState(existing)) return existing;
  const fresh: State = {
    provider: undefined,
    queue: [],
    consent: readStoredConsent(),
    listeners: new Set(),
    lastPage: undefined,
  };
  Reflect.set(globalThis, KEY, fresh);
  return fresh;
}

function send(call: Call): void {
  const s = state();
  if (s.provider) call(s.provider);
  else if (s.queue.length < QUEUE_LIMIT) s.queue.push(call);
}

/**
 * Starts analytics with a provider. Only the shell calls this. The first call wins; later calls
 * (a second mount, StrictMode, a remote running on its own) do nothing and return false.
 */
export function initAnalytics(provider: AnalyticsProvider): boolean {
  const s = state();
  if (s.provider) return false;
  s.provider = provider;
  provider.init({ ...s.consent });
  const queued = s.queue.splice(0);
  for (const call of queued) call(provider);
  return true;
}

export function isAnalyticsReady(): boolean {
  return state().provider !== undefined;
}

export function providerName(): string {
  return state().provider?.name ?? noopProvider.name;
}

export function track(event: string, params: EventParams = {}): void {
  send((p) => {
    p.track(event, params);
  });
}

export function page(path: string, params: EventParams = {}): void {
  send((p) => {
    p.page(path, params);
  });
}

/** Like `page`, but skips a path that was just sent: navigation and StrictMode can ask twice. */
export function pageOnce(path: string, params: EventParams = {}): void {
  const s = state();
  if (s.lastPage === path) return;
  s.lastPage = path;
  page(path, params);
}

export function identify(userId: string, traits: EventParams = {}): void {
  send((p) => {
    p.identify(userId, traits);
  });
}

/** The visitor's consent choice so far. A new object whenever it changes. */
export function getConsent(): ConsentUpdate {
  return state().consent;
}

/** Whether the visitor has made a choice, on this visit or an earlier one. */
export function hasConsentChoice(): boolean {
  return Object.keys(state().consent).length > 0;
}

export function subscribeConsent(listener: () => void): () => void {
  const { listeners } = state();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Records the visitor's choice, remembers it for next time and tells the provider. */
export function updateConsent(update: ConsentUpdate): void {
  const s = state();
  const clean = cleanConsent(update);
  s.consent = { ...s.consent, ...clean };
  writeStoredConsent(s.consent);
  send((p) => {
    p.setConsent(clean);
  });
  for (const listener of s.listeners) listener();
}

/** Only for tests: forgets the provider, the queue and the stored choice. */
export function resetAnalyticsForTests(): void {
  Reflect.deleteProperty(globalThis, KEY);
  try {
    localStorage.removeItem(CONSENT_STORAGE_KEY);
  } catch {
    // no storage in this environment
  }
}
