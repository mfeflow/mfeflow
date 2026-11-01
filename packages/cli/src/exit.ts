import { isMfeflowError, messageOf, type MfeflowError } from '@mfeflow/core';

/** Stable exit codes. Scripts can branch on them; changing one is a breaking change. */
export const EXIT = {
  ok: 0,
  unexpected: 1,
  usage: 2,
  project: 3,
  feature: 4,
  build: 5,
  registry: 6,
  deploy: 7,
  cancelled: 130,
} as const;

/** Raised when the user backs out of a prompt. */
export class Cancelled extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'Cancelled';
  }
}

/** Errors about what the person typed, whatever range they sit in. */
const USAGE_ERRORS: ReadonlySet<string> = new Set(['MFEFLOW_E107', 'MFEFLOW_E215']);

/** Exit code by the hundreds digit of the error code: E1xx project, E2xx feature, and so on. */
const BY_RANGE: Record<string, number> = {
  '1': EXIT.project,
  '2': EXIT.feature,
  '3': EXIT.build,
  '4': EXIT.registry,
  '5': EXIT.deploy,
};

/** The exit code of a catalogue code such as `MFEFLOW_E301`. */
export function exitCodeOfCode(code: string): number {
  if (USAGE_ERRORS.has(code)) return EXIT.usage;
  return BY_RANGE[code.charAt('MFEFLOW_E'.length)] ?? EXIT.unexpected;
}

export function exitCodeFor(error: unknown): number {
  if (error instanceof Cancelled) return EXIT.cancelled;
  if (!isMfeflowError(error)) return EXIT.unexpected;
  return exitCodeOfCode(error.code);
}

export interface ErrorReport {
  code: string;
  message: string;
  fix: string;
  docs: string;
}

export function reportOf(error: MfeflowError): ErrorReport {
  return { code: error.code, message: error.message, fix: error.fix, docs: error.docs };
}

/** What `--json` reports for an error that is no MfeflowError: a bug, so no code from the catalogue. */
export function unexpectedReport(error: unknown): ErrorReport {
  return {
    code: 'UNEXPECTED',
    message: messageOf(error),
    fix: 'This is a bug in mfeflow. Run again with --verbose for the stack, and report it.',
    docs: 'https://github.com/mfeflow/mfeflow/issues',
  };
}

/** What an unexpected (non-mfeflow) error prints: the message, and the stack with --verbose. */
export function unexpectedText(error: unknown, verbose: boolean): string {
  const stack =
    error instanceof Error && error.stack !== undefined ? error.stack : messageOf(error);
  return verbose
    ? stack
    : `Unexpected error: ${messageOf(error)}\n  Run again with --verbose for the stack.`;
}
