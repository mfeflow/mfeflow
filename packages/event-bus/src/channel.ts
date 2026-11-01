export const CHANNEL_EVENT = 'mfeflow:event-bus';

interface Message {
  origin: symbol;
  name: string;
  payload: unknown;
}

const copy = Symbol('copy');

function isMessage(value: unknown): value is Message {
  return (
    typeof value === 'object' && value !== null && typeof Reflect.get(value, 'name') === 'string'
  );
}

let stop: (() => void) | undefined;

/** Tells the other copies of the bus on this page. Does nothing without a window. */
export function broadcast(name: string, payload: unknown): void {
  if (typeof window === 'undefined') return;
  const detail: Message = { origin: copy, name, payload };
  window.dispatchEvent(new CustomEvent(CHANNEL_EVENT, { detail }));
}

/** Hands each message another copy sent to `deliver`. Listens once; a second call does nothing. */
export function listen(deliver: (name: string, payload: unknown) => void): void {
  if (typeof window === 'undefined' || stop) return;
  const on = (event: Event) => {
    if (!(event instanceof CustomEvent)) return;
    const detail: unknown = event.detail;
    if (!isMessage(detail) || detail.origin === copy) return;
    deliver(detail.name, detail.payload);
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
