/**
 * Every event the platform can carry, by versioned name: <domain>.<event>.v<major>, like
 * cart.item-added.v1. Types only: nothing here runs, so any remote can read it.
 *
 * Add an event by adding a line. Change a payload in a way old listeners cannot read by adding
 * a new version (cart.item-added.v2) and publishing both until every listener has moved.
 */
export interface Events {
  /** A remote is on the page. The sample event: every remote announces itself, every other one can listen. */
  'mfe.ready.v1': { mfe: string };
}
