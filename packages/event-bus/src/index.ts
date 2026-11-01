/**
 * Every event the platform knows, with its payload. Empty here: contracts add to it by
 * declaration merging, so `publish('cart.item-added.v1', { sku })` is checked end to end.
 *
 *   declare module '@mfeflow/event-bus' {
 *     interface EventMap {
 *       'cart.item-added.v1': { sku: string };
 *       'cart.cleared.v1': undefined;
 *     }
 *   }
 */
// oxlint-disable-next-line typescript/no-empty-interface -- merged by each contract
export interface EventMap {}

export {
  configureEvent,
  isEventName,
  listenerCount,
  publish,
  resetEventBusForTests,
  subscribe,
  type EventConfig,
  type EventName,
  type Handler,
  type PayloadArgs,
  type SubscribeOptions,
} from './bus';
