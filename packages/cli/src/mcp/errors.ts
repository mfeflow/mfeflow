import { ERROR_CATALOGUE, type ErrorCode } from '@mfeflow/core';
import { errorDocsUrl } from '@mfeflow/contracts';

export interface ExplainedError {
  code: string;
  title: string;
  fix: string;
  docs: string;
}

const CODE = /^(?:MFEFLOW_)?(E\d{3})$/i;
const IN_TEXT = /MFEFLOW_(E\d{3})/gi;

function isKnown(code: string): code is ErrorCode {
  return code in ERROR_CATALOGUE;
}

/** The catalogue entry for `E123`, `MFEFLOW_E123` or `e123`; undefined when there is none. */
export function explainCode(input: string): ExplainedError | undefined {
  const code = CODE.exec(input.trim())?.[1]?.toUpperCase();
  if (code === undefined || !isKnown(code)) return undefined;
  const info = ERROR_CATALOGUE[code];
  return { code: `MFEFLOW_${code}`, title: info.title, fix: info.fix, docs: errorDocsUrl(code) };
}

/** Every distinct known code in a pasted log, in the order it first appears. */
export function explainLog(log: string): { found: ExplainedError[]; unknown: string[] } {
  const seen = new Set<string>();
  const found: ExplainedError[] = [];
  const unknown: string[] = [];
  for (const match of log.matchAll(IN_TEXT)) {
    const code = match[1]?.toUpperCase();
    if (code === undefined || seen.has(code)) continue;
    seen.add(code);
    const explained = explainCode(code);
    if (explained) found.push(explained);
    else unknown.push(`MFEFLOW_${code}`);
  }
  return { found, unknown };
}
