import { configureEvent } from '@mfeflow/event-bus';

export * from '@mfeflow/event-bus';
export type { CompanyEvents } from './events';

/**
 * How the company's events behave: the settings of each, one line per event. Call it once in the shell; a
 * remote may call it too, since later calls change only what they name.
 */
export function configureCompanyEvents(): void {
  // A remote that mounts after the session expired still learns about it.
  configureEvent('session.expired.v1', { replay: true });
}
