import { useEffect, useRef } from 'react';
import { subscribe, type EventName, type Handler, type SubscribeOptions } from './bus';

/**
 * Calls `handler` for each `name` while the component is mounted. The handler may change on every
 * render without resubscribing. An event that replays calls it once on mount with the last payload,
 * which under StrictMode happens once per mount, so keep a handler that replays idempotent.
 */
export function useEvent<K extends EventName>(
  name: K,
  handler: Handler<K>,
  options: SubscribeOptions = {},
): void {
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  const { replay } = options;
  useEffect(
    () =>
      subscribe(
        name,
        (payload) => {
          latest.current(payload);
        },
        { replay },
      ),
    [name, replay],
  );
}
