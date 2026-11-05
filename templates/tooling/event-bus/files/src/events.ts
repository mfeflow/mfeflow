/**
 * The events every app can publish and subscribe to, with their payloads: the name is
 * `<domain>.<event>.v<major>`, the value is the payload type (`undefined` for none). Add yours.
 */
export interface CompanyEvents {
  'session.expired.v1': undefined;
}

declare module '@mfeflow/event-bus' {
  // oxlint-disable-next-line typescript/no-empty-interface -- merged into the bus's event map
  interface EventMap extends CompanyEvents {}
}
