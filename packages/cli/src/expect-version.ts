import { MfeflowError } from '@mfeflow/core';

/** The version `--expect-version` named, if any. */
export function expectedVersion(args: Record<string, unknown>): string | undefined {
  const value = args['expect-version'];
  return typeof value === 'string' ? value : undefined;
}

/** Refuses a promote whose source is not the version `--expect-version` named (E510). */
export function assertExpectedVersion(
  args: Record<string, unknown>,
  from: string,
  name: string,
  served: string,
): void {
  const expected = expectedVersion(args);
  if (expected === undefined || expected === served) return;
  throw new MfeflowError(
    'E510',
    `${from} serves ${name}@${served}, not ${expected} as expected; check \`mfeflow status\` and plan again`,
  );
}
