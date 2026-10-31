import { MfeflowError, type ErrorCode } from '@mfeflow/core';
import type { ProjectView } from './inspect';

export type Severity = 'error' | 'warning';

export interface Finding {
  code: string;
  severity: Severity;
  /** The check that found it, like `config.ports`. */
  check: string;
  message: string;
  fix: string;
  docs: string;
  app?: string;
  path?: string;
  /** `doctor --fix` can repair it. */
  fixable: boolean;
}

export interface FindingOptions {
  severity?: Severity;
  app?: string;
  path?: string;
  fixable?: boolean;
}

/** A finding carrying the catalogue's code, message, fix and docs link. */
export function finding(
  check: string,
  code: ErrorCode,
  detail: string,
  options: FindingOptions = {},
): Finding {
  const error = new MfeflowError(code, detail);
  const out: Finding = {
    code: error.code,
    severity: options.severity ?? 'error',
    check,
    message: error.message,
    fix: error.fix,
    docs: error.docs,
    fixable: options.fixable ?? false,
  };
  if (options.app !== undefined) out.app = options.app;
  if (options.path !== undefined) out.path = options.path;
  return out;
}

export interface CheckOutcome {
  findings: Finding[];
  /** Why the check did not run. */
  skipped?: string;
}

export interface Check {
  id: string;
  title: string;
  run(view: ProjectView): Promise<CheckOutcome>;
}

export const done = (findings: Finding[]): Promise<CheckOutcome> => Promise.resolve({ findings });
