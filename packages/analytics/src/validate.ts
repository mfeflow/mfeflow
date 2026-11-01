const EVENT_NAME = /^[a-z][a-z0-9_]{0,39}$/i;
const warned = new Set<string>();

/** Dev builds warn about mistakes; production builds stay quiet. Bundlers replace `process.env.NODE_ENV`. */
export const isDev = (): boolean => process.env.NODE_ENV !== 'production';

export function warnOnce(message: string): void {
  if (!isDev() || warned.has(message)) return;
  warned.add(message);
  console.warn(`[mfeflow/analytics] ${message}`);
}

/** What is wrong with an event, or undefined. `known` is the tracker's declared list, if it has one. */
export function eventProblem(
  mfe: string,
  event: string,
  known: ReadonlySet<string> | undefined,
): string | undefined {
  if (!EVENT_NAME.test(event)) {
    return `${mfe}: "${event}" is not a valid event name (letters, digits and underscores, starting with a letter, at most 40 characters)`;
  }
  if (known && !known.has(event)) {
    return `${mfe}: "${event}" is not one of the events this tracker declares (${[...known].join(', ') || 'none'}); add it to analytics.ts`;
  }
  return undefined;
}

/** Only for tests. */
export function resetWarningsForTests(): void {
  warned.clear();
}
