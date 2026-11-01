import { warnOnce } from './warn';

/** Bumped when the shape of the shared registry changes; copies that disagree stop sharing it. */
export const PROTOCOL = 1;

export type Listener = (payload: unknown) => void;

/** One subscription. The set holds these, not the functions, so subscribing a function twice is two subscriptions. */
export interface Subscription {
  readonly handler: Listener;
}

export interface Config {
  replay: boolean;
  validate: ((payload: unknown) => unknown) | undefined;
}

export interface Registry {
  protocol: number;
  listeners: Map<string, Set<Subscription>>;
  /** The last payload of each event that replays. */
  last: Map<string, unknown>;
  config: Map<string, Config>;
  /** Ids of the latest events delivered, so an event that arrives twice (directly and over the window) is delivered once. */
  delivered: Set<string>;
  /** One entry per copy of this package that has used the registry. */
  copies: Set<symbol>;
}

const KEY = Symbol.for('mfeflow.event-bus');
const COPY = Symbol('copy');

function create(): Registry {
  return {
    protocol: PROTOCOL,
    listeners: new Map(),
    last: new Map(),
    config: new Map(),
    delivered: new Set(),
    copies: new Set(),
  };
}

function isRegistry(value: unknown): value is Registry {
  return (
    typeof value === 'object' &&
    value !== null &&
    Reflect.get(value, 'protocol') === PROTOCOL &&
    Reflect.get(value, 'listeners') instanceof Map &&
    Reflect.get(value, 'last') instanceof Map &&
    Reflect.get(value, 'config') instanceof Map &&
    Reflect.get(value, 'delivered') instanceof Set &&
    Reflect.get(value, 'copies') instanceof Set
  );
}

let own: Registry | undefined;

/** Registers this copy, and says so in development when it is not the only one. */
function attach(shared: Registry): Registry {
  if (shared.copies.has(COPY)) return shared;
  shared.copies.add(COPY);
  if (shared.copies.size > 1) {
    warnOnce(
      'two copies of @mfeflow/event-bus are loaded on this page. They share their subscribers, so events still arrive, but a remote is bundling its own copy: share @mfeflow/event-bus as a singleton (@mfeflow/rsbuild does) and make sure the shell imports it.',
    );
  }
  return shared;
}

/**
 * The registry every copy of this package on the page shares, kept on `globalThis` so a second
 * copy (a missing singleton share) still reaches the same subscribers. A copy that finds one it
 * cannot read (another protocol) keeps its own and talks to the other copies through
 * the window bridge in `./channel` only.
 */
export function registry(): Registry {
  if (own) return own;
  const existing: unknown = Reflect.get(globalThis, KEY);
  if (existing === undefined) {
    const fresh = create();
    Reflect.set(globalThis, KEY, fresh);
    return attach(fresh);
  }
  if (isRegistry(existing)) return attach(existing);
  warnOnce(
    'another copy of @mfeflow/event-bus on this page speaks a different protocol, so this copy cannot share its subscribers. It falls back to window events; share @mfeflow/event-bus as a singleton so one copy is loaded.',
  );
  own = create();
  return own;
}

/** Only for tests: forgets every subscriber, replayed payload and setting, and this copy's isolation. */
export function resetRegistry(): void {
  own = undefined;
  Reflect.deleteProperty(globalThis, KEY);
}
