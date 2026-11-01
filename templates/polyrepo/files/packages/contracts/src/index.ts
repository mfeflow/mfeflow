// Names and shapes that more than one repo depends on. A change here is a change for every team,
// so it goes through a pull request and a changeset like any other published package.
export const EVENTS = {
  navigate: 'platform:navigate',
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];

export interface NavigateEvent {
  path: string;
}
