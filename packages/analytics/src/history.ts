import { currentPath } from './url';

const EVENT = 'mfeflow:navigate';
const PATCHED = Symbol.for('mfeflow.history-patched');

function patchHistory(): void {
  if (Reflect.get(history, PATCHED) === true) return;
  Reflect.set(history, PATCHED, true);
  for (const method of ['pushState', 'replaceState'] as const) {
    const original = history[method].bind(history);
    history[method] = (...args: Parameters<History['pushState']>) => {
      original(...args);
      dispatchEvent(new Event(EVENT));
    };
  }
}

/**
 * Calls `listener` with the new path whenever the page navigates without a reload: `pushState`,
 * `replaceState`, back/forward and hash changes. The path carries the query string and a hash
 * route, with personal data removed (see `currentPath`). Works with any router. The first call
 * patches `history` once.
 */
export function onNavigate(listener: (path: string) => void): () => void {
  patchHistory();
  const handle = () => {
    listener(currentPath());
  };
  addEventListener(EVENT, handle);
  addEventListener('popstate', handle);
  addEventListener('hashchange', handle);
  return () => {
    removeEventListener(EVENT, handle);
    removeEventListener('popstate', handle);
    removeEventListener('hashchange', handle);
  };
}
