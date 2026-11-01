import { registerPlugins } from '@module-federation/enhanced/runtime';
import { REMOTE_ERROR_EVENT, remoteVersion } from './report';
import { registrySources, type RegistrySources } from './registry';
import { RUNTIME_CONFIG_KEY, type RuntimeConfigValues } from './runtime-config';

/** The registry server's endpoint for these index URLs, and the env they name. */
export interface BeaconTarget {
  url: string;
  env: string;
}

const SERVER_INDEX = /\/v1\/index\/([a-z][a-z0-9-]*)$/;
/** Only used to parse relative URLs; nothing is ever fetched from it. */
const PARSE_BASE = 'https://page.invalid';
/** The server takes 20 entries and 4 KiB per beacon. */
const MAX_ENTRIES = 20;
const MAX_BYTES = 4096;
/** Most remotes a page keeps counts for; sent in several beacons if needed. */
const MAX_PENDING = 200;
export const CLIENT_ID_KEY = 'mfeflow:client';

/** The first index URL that is a registry server's `/v1/index/<env>`. A static host has no beacon. */
export function beaconTarget(urls: readonly string[]): BeaconTarget | undefined {
  for (const raw of urls) {
    if (!URL.canParse(raw, PARSE_BASE)) continue;
    const url = new URL(raw, PARSE_BASE);
    const env = SERVER_INDEX.exec(url.pathname)?.[1];
    if (env === undefined) continue;
    const beacon = new URL(raw, typeof location === 'undefined' ? PARSE_BASE : location.href);
    beacon.pathname = beacon.pathname.replace(SERVER_INDEX, '/v1/beacon');
    beacon.search = '';
    beacon.hash = '';
    return { url: beacon.href, env };
  }
  return undefined;
}

/** 128 random bits. `getRandomValues` works on pages that are not on a secure origin, unlike `randomUUID`. */
const randomId = (): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');

let memoryId: string | undefined;

/** A stable id for this browser, so the server keeps giving it the same rollout side. Not tied to a person. */
export function clientId(): string {
  try {
    const stored = localStorage.getItem(CLIENT_ID_KEY);
    if (stored !== null && /^[\w.:-]{1,128}$/.test(stored)) return stored;
    const fresh = randomId();
    localStorage.setItem(CLIENT_ID_KEY, fresh);
    return fresh;
  } catch {
    memoryId ??= randomId();
    return memoryId;
  }
}

/** The server index URLs get `?u=<client id>`; any other URL is returned as it came. */
export function withClientId(url: string, id: string = clientId()): string {
  if (!URL.canParse(url, PARSE_BASE)) return url;
  const parsed = new URL(url, PARSE_BASE);
  if (!SERVER_INDEX.test(parsed.pathname)) return url;
  const absolute = URL.canParse(url);
  const target = absolute ? new URL(url) : parsed;
  target.searchParams.set('u', id);
  return absolute ? target.href : `${target.pathname}${target.search}${target.hash}`;
}

const byteLength = (text: string): number => new TextEncoder().encode(text).length;

export type Send = (url: string, body: string) => boolean;

export interface BeaconReporter {
  load(remote: string, version: string): void;
  error(remote: string, version: string): void;
  /** Sends what has been counted since the last flush as one request. Nothing counted, nothing sent. */
  flush(): void;
  stop(): void;
}

/**
 * Counts, per remote@version, whether this page loaded it and whether it failed, and sends the
 * page's counts as one request: `{ env, u, entries }`. A page is one load and at most one error
 * for a remote, so the error rate reads as "page views that hit an error". What was sent is
 * remembered, so a flush on `visibilitychange` followed by more loads never reports the same load
 * again. An error that comes after a clean report is sent once more.
 */
export function createBeaconReporter(
  target: BeaconTarget,
  send: Send,
  client: string = clientId(),
): BeaconReporter {
  const pending = new Map<string, { remote: string; version: string; failed: boolean }>();
  const sent = new Map<string, boolean>();
  const note = (remote: string, version: string, failed: boolean): void => {
    const key = `${remote}@${version}`;
    const before = sent.get(key);
    if (before !== undefined && (before || !failed)) return;
    const known = pending.get(key);
    if (known !== undefined) known.failed ||= failed;
    else if (pending.size < MAX_PENDING) pending.set(key, { remote, version, failed });
  };
  const flush = (): void => {
    if (pending.size === 0) return;
    const batch = [...pending.entries()];
    pending.clear();
    for (const [key, { failed }] of batch) sent.set(key, failed);
    const head = JSON.stringify({ env: target.env, u: client, entries: [] });
    let chunk: { remote: string; version: string; loads: 1; errors: 0 | 1 }[] = [];
    let size = head.length;
    const emit = (): void => {
      if (chunk.length > 0)
        send(target.url, JSON.stringify({ env: target.env, u: client, entries: chunk }));
      chunk = [];
      size = head.length;
    };
    for (const [, { remote, version, failed }] of batch) {
      const entry = {
        remote,
        version,
        loads: 1 as const,
        errors: failed ? (1 as const) : (0 as const),
      };
      const extra = byteLength(JSON.stringify(entry)) + 1;
      if (chunk.length === MAX_ENTRIES || size + extra > MAX_BYTES) emit();
      chunk.push(entry);
      size += extra;
    }
    emit();
  };
  const onError = (event: Event): void => {
    const detail: unknown = event instanceof CustomEvent ? event.detail : undefined;
    const mfe: unknown =
      typeof detail === 'object' && detail !== null ? Reflect.get(detail, 'mfe') : undefined;
    const version: unknown =
      typeof detail === 'object' && detail !== null ? Reflect.get(detail, 'version') : undefined;
    if (typeof mfe === 'string' && typeof version === 'string') note(mfe, version, true);
  };
  const onHide = (): void => {
    if (typeof document === 'undefined' || document.visibilityState === 'hidden') flush();
  };
  window.addEventListener(REMOTE_ERROR_EVENT, onError);
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', onHide);
  return {
    load: (remote, version) => note(remote, version, false),
    error: (remote, version) => note(remote, version, true),
    flush,
    stop() {
      window.removeEventListener(REMOTE_ERROR_EVENT, onError);
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onHide);
      pending.clear();
      sent.clear();
    },
  };
}

const sendWithBeacon: Send = (url, body) =>
  typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function'
    ? navigator.sendBeacon(url, body)
    : false;

let active: BeaconReporter | undefined;

/** Stops the running reporter so the next start is a fresh one. For tests. */
export function resetRegistryBeaconForTests(): void {
  active?.stop();
  active = undefined;
}

/**
 * Starts the reporter when the runtime config has `registryBeacon: true` and one of the index URLs
 * is a registry server's. Otherwise does nothing. Calling it again returns the reporter already
 * running, so the Module Federation plugin is registered once.
 */
export function startRegistryBeacon(
  config: RuntimeConfigValues,
  urls: readonly string[],
  send: Send = sendWithBeacon,
): BeaconReporter | undefined {
  if (config.registryBeacon !== true) return undefined;
  if (active !== undefined) return active;
  const target = beaconTarget(urls);
  if (target === undefined) return undefined;
  const reporter = createBeaconReporter(target, send);
  active = reporter;
  registerPlugins([
    {
      name: 'mfeflow-beacon',
      onLoad(args) {
        const remote = args.id.split('/')[0] ?? args.id;
        const version = remoteVersion(remote);
        if (version !== undefined) reporter.load(remote, version);
      },
    },
  ]);
  return reporter;
}

const isConfig = (value: unknown): value is RuntimeConfigValues =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * `registrySources()` for a shell that wants the beacon. With `registryBeacon: true` in the runtime
 * config it adds this browser's id to the registry server's index URLs and starts the reporter;
 * without it, the sources come back untouched. Import it on demand
 * (`await import('@mfeflow/runtime/beacon')`) so a shell with the option off never downloads it.
 */
export async function registrySourcesWithBeacon(waitMs?: number): Promise<RegistrySources> {
  const sources = await registrySources(waitMs);
  const config: unknown = Reflect.get(globalThis, RUNTIME_CONFIG_KEY);
  if (!isConfig(config) || config.registryBeacon !== true) return sources;
  try {
    const urls = sources.urls.map((url) => withClientId(url));
    startRegistryBeacon(config, urls);
    return { ...sources, urls };
  } catch {
    return sources;
  }
}
