const seen = new Set<string>();

/** Dev builds warn about mistakes; production builds stay quiet. Bundlers replace `process.env.NODE_ENV`. */
export const isDev = (): boolean => process.env.NODE_ENV !== 'production';

export function warnOnce(message: string): void {
  if (!isDev() || seen.has(message)) return;
  seen.add(message);
  console.warn(`[mfeflow/event-bus] ${message}`);
}

/** Only for tests. */
export function resetWarningsForTests(): void {
  seen.clear();
}
