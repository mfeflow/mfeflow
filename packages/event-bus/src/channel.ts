export const CHANNEL_EVENT = 'mfeflow:event-bus';

interface Message {
  id: string;
  name: string;
  payload: unknown;
}

function isMessage(value: unknown): value is Message {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'id') === 'string' &&
    typeof Reflect.get(value, 'name') === 'string'
  );
}

let stop: (() => void) | undefined;

/**
 * Tells the other copies of the bus on this page, which may keep their own registry. Copies that
 * share a registry get it twice and drop the second by `id`. Does nothing without a window.
 */
export function broadcast(id: string, name: string, payload: unknown): void {
  if (typeof window === 'undefined') return;
  const detail: Message = { id, name, payload };
  window.dispatchEvent(new CustomEvent(CHANNEL_EVENT, { detail }));
}

/** Hands each message to `deliver`. Listens once; a second call does nothing. */
export function listen(deliver: (id: string, name: string, payload: unknown) => void): void {
  if (typeof window === 'undefined' || stop) return;
  const on = (event: Event) => {
    if (!(event instanceof CustomEvent)) return;
    const detail: unknown = event.detail;
    if (isMessage(detail)) deliver(detail.id, detail.name, detail.payload);
  };
  window.addEventListener(CHANNEL_EVENT, on);
  stop = () => {
    window.removeEventListener(CHANNEL_EVENT, on);
  };
}

/** Only for tests. */
export function stopListening(): void {
  stop?.();
  stop = undefined;
}
