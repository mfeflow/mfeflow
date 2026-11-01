import { broadcast, listen, stopListening } from './channel';
import type { EventMap } from './index';
import { isIsolated, registry, resetRegistry, type Config, type Registry } from './registry';
import { resetWarningsForTests, warnOnce } from './warn';

/** The names an event can be published under. */
export type EventName = Extract<keyof EventMap, string>;

export type Handler<K extends EventName> = (payload: EventMap[K]) => void;

/** `[]` for an event whose payload is `undefined`, `[payload]` for the rest. */
export type PayloadArgs<K extends EventName> = [EventMap[K]] extends [undefined]
  ? [payload?: undefined]
  : [payload: EventMap[K]];

export interface EventConfig<T> {
  /** Give each new subscriber the last payload right away. Off by default: most events are things that happened, not state. */
  replay?: boolean;
  /**
   * Runs on every publish. Return the payload (parsed, if you like) or throw to reject it: a
   * rejected payload reaches nobody. No validator ships here; `@mfeflow/event-bus/standard-schema`
   * turns a Zod, Valibot or ArkType schema into one.
   */
  validate?: (payload: unknown) => T;
}

export interface SubscribeOptions {
  /** Skip the replayed payload of an event that replays. Default true. */
  replay?: boolean | undefined;
}

// <domain>.<event>.v<major>, for example cart.item-added.v1
const NAME = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+\.v[1-9][0-9]*$/;

export function isEventName(name: string): boolean {
  return NAME.test(name);
}

function checkName(name: string): void {
  if (!NAME.test(name)) {
    warnOnce(
      `"${name}" is not a versioned event name; use <domain>.<event>.v<major>, like cart.item-added.v1`,
    );
  }
}

function reportHandlerError(name: string, error: unknown): void {
  console.error(`[mfeflow/event-bus] a handler for "${name}" threw`, error);
}

function call(name: string, handler: (payload: unknown) => void, payload: unknown): void {
  try {
    handler(payload);
  } catch (error) {
    reportHandlerError(name, error);
  }
}

function deliver(r: Registry, name: string, payload: unknown): void {
  const set = r.listeners.get(name);
  if (!set) return;
  // A copy, and a check before each call: a handler may subscribe or unsubscribe while we run.
  for (const handler of Array.from(set)) {
    if (set.has(handler)) call(name, handler, payload);
  }
}

function remember(r: Registry, name: string, payload: unknown): void {
  if (r.config.get(name)?.replay) r.last.set(name, payload);
}

function receive(name: string, payload: unknown): void {
  const r = registry();
  remember(r, name, payload);
  deliver(r, name, payload);
}

/**
 * Tells every subscriber, in every remote on the page. Returns false when the event's validator
 * rejected the payload (nothing was sent, and the reason is logged without the payload).
 */
export function publish<K extends EventName>(name: K, ...args: PayloadArgs<K>): boolean {
  checkName(name);
  const r = registry();
  let payload: unknown = args[0];
  const validate = r.config.get(name)?.validate;
  if (validate) {
    try {
      payload = validate(payload);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'invalid payload';
      console.error(`[mfeflow/event-bus] "${name}" was not sent: ${reason}`);
      return false;
    }
  }
  remember(r, name, payload);
  deliver(r, name, payload);
  if (isIsolated()) {
    listen(receive);
    broadcast(name, payload);
  }
  return true;
}

/** Calls `handler` for every `name` published from now on. Returns the function that stops it. */
export function subscribe<K extends EventName>(
  name: K,
  handler: Handler<K>,
  options: SubscribeOptions = {},
): () => void {
  checkName(name);
  const r = registry();
  if (isIsolated()) listen(receive);
  // The bus hands over what was published as `name`; the map says what that is.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- payloads were typed at publish
  const listener = handler as (payload: unknown) => void;
  const set = r.listeners.get(name) ?? new Set();
  r.listeners.set(name, set);
  set.add(listener);
  if (options.replay !== false && r.config.get(name)?.replay && r.last.has(name)) {
    call(name, listener, r.last.get(name));
  }
  return () => {
    set.delete(listener);
    if (set.size === 0 && r.listeners.get(name) === set) r.listeners.delete(name);
  };
}

/** Sets how an event behaves. Safe to call from every remote that cares; later calls change only what they name. */
export function configureEvent<K extends EventName>(
  name: K,
  config: EventConfig<EventMap[K]>,
): void {
  checkName(name);
  const r = registry();
  const before: Config = r.config.get(name) ?? { replay: false, validate: undefined };
  const next: Config = {
    replay: config.replay ?? before.replay,
    validate: config.validate ?? before.validate,
  };
  r.config.set(name, next);
  if (!next.replay) r.last.delete(name);
}

/** How many handlers are subscribed to `name`; for tests and the dev overlay. */
export function listenerCount(name: string): number {
  return registry().listeners.get(name)?.size ?? 0;
}

/** Only for tests: forgets every subscriber, replayed payload and setting. */
export function resetEventBusForTests(): void {
  stopListening();
  resetRegistry();
  resetWarningsForTests();
}
