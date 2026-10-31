import { useCallback, useSyncExternalStore } from 'react';
import type { Guard, MfeStorage } from '.';

type Next<T> = T | ((prev: T) => T);

function isUpdater<T>(next: Next<T>): next is (prev: T) => T {
  return typeof next === 'function';
}

/**
 * React state backed by an `MfeStorage` key. Stays in sync across components,
 * remotes using the same storage, and browser tabs.
 */
export function useStoredState<T>(
  storage: MfeStorage,
  key: string,
  initial: T,
  guard?: Guard<T>,
): [T, (next: Next<T>) => void] {
  const subscribe = useCallback(
    (onChange: () => void) => storage.subscribe(key, onChange),
    [storage, key],
  );
  // read() returns the same reference until the stored value changes.
  const getSnapshot = useCallback(() => storage.read(key), [storage, key]);
  const getServerSnapshot = useCallback(() => undefined, []);
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const value = storage.get(key, initial, guard);

  const set = useCallback(
    (next: Next<T>) => {
      const resolved = isUpdater(next) ? next(storage.get(key, initial, guard)) : next;
      storage.set(key, resolved);
    },
    [storage, key, initial, guard],
  );

  return [value, set];
}
