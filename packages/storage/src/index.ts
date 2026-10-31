/** Where values live. `memory` is used automatically when no Web Storage exists (SSR, sandboxed iframes). */
export type StorageArea = 'local' | 'session' | 'memory';

export interface CreateStorageOptions {
  /** Default `local`. */
  area?: StorageArea;
  /** Use this Storage instead of the browser's (tests, custom adapters). */
  backend?: Storage;
}

/** Called with the new value (already parsed), or `undefined` when the key was removed. */
export type Listener = (value: unknown) => void;

/** Narrows an untrusted stored value. */
export type Guard<T> = (value: unknown) => value is T;

export interface MfeStorage {
  /** The micro-frontend this storage belongs to. Keys are stored as `<mfe>:<key>`. */
  readonly mfe: string;
  /** The stored value, or `undefined`. Returns the same reference until the value changes. */
  read(key: string): unknown;
  /** The stored value if `guard` accepts it, otherwise `fallback`. */
  get<T>(key: string, fallback: T, guard?: Guard<T>): T;
  set(key: string, value: unknown): void;
  remove(key: string): void;
  /** Keys owned by this micro-frontend, without the prefix. */
  keys(): string[];
  /** Called on changes from this tab and from other tabs. Returns an unsubscribe function. */
  subscribe(key: string, listener: Listener): () => void;
}

type Bus = WeakMap<Storage, Map<string, Set<Listener>>>;

declare global {
  // Shared by every createStorage() call and every copy of this package on the
  // page, so all instances that use the same backend and key stay in sync.
  var mfeflowStorageBus: Bus | undefined;
}

const MFE_NAME = /^[a-z0-9][a-z0-9_-]*$/i;

class MemoryStorage implements Storage {
  #map = new Map<string, string>();
  get length(): number {
    return this.#map.size;
  }
  clear(): void {
    this.#map.clear();
  }
  getItem(key: string): string | null {
    return this.#map.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.#map.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.#map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.#map.set(key, value);
  }
}

function browserStorage(area: StorageArea): Storage | undefined {
  if (area === 'memory' || typeof window === 'undefined') return undefined;
  try {
    const s = area === 'session' ? window.sessionStorage : window.localStorage;
    const probe = '__mfeflow_probe__';
    s.setItem(probe, probe);
    s.removeItem(probe);
    return s;
  } catch {
    return undefined;
  }
}

function listenersFor(backend: Storage, fullKey: string): Set<Listener> {
  globalThis.mfeflowStorageBus ??= new WeakMap();
  const bus = globalThis.mfeflowStorageBus;
  let byKey = bus.get(backend);
  if (!byKey) {
    byKey = new Map();
    bus.set(backend, byKey);
  }
  let set = byKey.get(fullKey);
  if (!set) {
    set = new Set();
    byKey.set(fullKey, set);
  }
  return set;
}

function parse(raw: string | null): unknown {
  if (raw === null) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    return value;
  } catch {
    return undefined;
  }
}

/**
 * Storage for one micro-frontend. Every key is prefixed with the MFE's name,
 * so two remotes can both use `theme` or `filters` without overwriting each other.
 */
export function createStorage(mfe: string, options: CreateStorageOptions = {}): MfeStorage {
  if (!MFE_NAME.test(mfe)) {
    throw new Error(
      `createStorage: invalid micro-frontend name "${mfe}" (use letters, digits, - and _)`,
    );
  }
  const area = options.area ?? 'local';
  const backend: Storage = options.backend ?? browserStorage(area) ?? new MemoryStorage();
  const prefix = `${mfe}:`;
  const cache = new Map<string, { raw: string | null; value: unknown }>();
  let subscriptions = 0;

  const notify = (key: string, value: unknown): void => {
    for (const l of listenersFor(backend, prefix + key)) l(value);
  };

  const onStorageEvent = (e: StorageEvent): void => {
    if (e.storageArea !== backend || e.key === null || !e.key.startsWith(prefix)) return;
    notify(e.key.slice(prefix.length), parse(e.newValue));
  };

  const read = (key: string): unknown => {
    const raw = backend.getItem(prefix + key);
    const hit = cache.get(key);
    if (hit?.raw === raw) return hit.value;
    const value = parse(raw);
    cache.set(key, { raw, value });
    return value;
  };

  return {
    mfe,
    read,
    get<T>(key: string, fallback: T, guard?: Guard<T>): T {
      const value = read(key);
      if (value === undefined) return fallback;
      if (guard) return guard(value) ? value : fallback;
      if (typeof value !== typeof fallback || Array.isArray(value) !== Array.isArray(fallback))
        return fallback;
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- same runtime type as the fallback; pass a guard to validate the shape
      return value as T;
    },
    set(key, value) {
      try {
        backend.setItem(prefix + key, JSON.stringify(value));
      } catch {
        // Quota exceeded or storage disabled: keep going, the value just is not persisted.
      }
      notify(key, value);
    },
    remove(key) {
      backend.removeItem(prefix + key);
      notify(key, undefined);
    },
    keys() {
      const out: string[] = [];
      for (let i = 0; i < backend.length; i++) {
        const k = backend.key(i);
        if (k?.startsWith(prefix)) out.push(k.slice(prefix.length));
      }
      return out;
    },
    subscribe(key, listener) {
      const set = listenersFor(backend, prefix + key);
      // Wrap so the same function subscribed twice gets two independent entries.
      const l: Listener = (value) => {
        listener(value);
      };
      set.add(l);
      if (subscriptions++ === 0 && typeof window !== 'undefined') {
        window.addEventListener('storage', onStorageEvent);
      }
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        set.delete(l);
        if (--subscriptions === 0 && typeof window !== 'undefined') {
          window.removeEventListener('storage', onStorageEvent);
        }
      };
    },
  };
}
