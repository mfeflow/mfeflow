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
 * `replaceState` and back/forward. Works with any router. The first call patches `history` once.
 */
export function onNavigate(listener: (path: string) => void): () => void {
  patchHistory();
  const handle = () => {
    listener(location.pathname);
  };
  addEventListener(EVENT, handle);
  addEventListener('popstate', handle);
  return () => {
    removeEventListener(EVENT, handle);
    removeEventListener('popstate', handle);
  };
}
