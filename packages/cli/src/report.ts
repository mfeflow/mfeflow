import type { Check, Finding } from './findings';
import type { ProjectView } from './inspect';
import { EXIT, exitCodeOfCode } from './exit';

export interface CheckReport {
  id: string;
  title: string;
  status: 'pass' | 'warn' | 'fail' | 'skipped';
  /** Why a skipped check did not run. */
  skipped?: string;
  findings: number;
}

export interface Summary {
  errors: number;
  warnings: number;
  skipped: number;
  fixed: number;
}

export interface Report {
  checks: CheckReport[];
  findings: Finding[];
}

export async function runChecks(view: ProjectView, checks: readonly Check[]): Promise<Report> {
  const outcomes = await Promise.all(checks.map((check) => check.run(view)));
  const reports = checks.map((check, i): CheckReport => {
    const outcome = outcomes[i] ?? { findings: [] };
    const hasError = outcome.findings.some((f) => f.severity === 'error');
    const status =
      outcome.skipped !== undefined
        ? 'skipped'
        : hasError
          ? 'fail'
          : outcome.findings.length > 0
            ? 'warn'
            : 'pass';
    return {
      id: check.id,
      title: check.title,
      status,
      ...(outcome.skipped === undefined ? {} : { skipped: outcome.skipped }),
      findings: outcome.findings.length,
    };
  });
  return { checks: reports, findings: outcomes.flatMap((o) => o.findings) };
}

export function summarizeReport(report: Report, fixed: number): Summary {
  return {
    errors: report.findings.filter((f) => f.severity === 'error').length,
    warnings: report.findings.filter((f) => f.severity === 'warning').length,
    skipped: report.checks.filter((c) => c.status === 'skipped').length,
    fixed,
  };
}

/** Exit code of a report: 0 without errors, else the lowest code among the errors' ranges (project before build). */
export function exitForFindings(findings: readonly Finding[]): number {
  const codes = findings.filter((f) => f.severity === 'error').map((f) => exitCodeOfCode(f.code));
  return codes.length === 0 ? EXIT.ok : Math.min(...codes);
}

const MARK = { pass: 'ok  ', warn: 'warn', fail: 'FAIL', skipped: 'skip' } as const;

/** The human form: one line per check, then each finding with its fix and docs link. */
export function formatReport(report: Report, summary: Summary): string {
  const lines = report.checks.map(
    (c) => `${MARK[c.status]}  ${c.title}${c.skipped === undefined ? '' : ` (${c.skipped})`}`,
  );
  for (const f of report.findings) {
    lines.push(
      '',
      `${f.severity === 'error' ? 'error' : 'warning'} ${f.code} ${f.message}`,
      `  Fix: ${f.fix}${f.fixable ? ' (mfeflow doctor --fix)' : ''}`,
      `  ${f.docs}`,
    );
  }
  lines.push(
    '',
    `${String(summary.errors)} error(s), ${String(summary.warnings)} warning(s), ${String(summary.skipped)} skipped${summary.fixed > 0 ? `, ${String(summary.fixed)} fixed` : ''}`,
  );
  return lines.join('\n');
}
