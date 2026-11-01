import { MfeflowError } from '@mfeflow/core';
import { describe, expect, it } from 'vitest';
import { Cancelled, EXIT, exitCodeFor, exitCodeOfCode, reportOf, unexpectedText } from './exit';

describe('exit codes', () => {
  it('maps each error range to its own code', () => {
    const code = (c: ConstructorParameters<typeof MfeflowError>[0]) =>
      exitCodeFor(new MfeflowError(c));
    expect(code('E107')).toBe(EXIT.usage);
    expect(code('E215')).toBe(EXIT.usage);
    expect(code('E102')).toBe(EXIT.project);
    expect(code('E108')).toBe(EXIT.project);
    expect(code('E201')).toBe(EXIT.feature);
    expect(code('E213')).toBe(EXIT.feature);
    expect(code('E401')).toBe(EXIT.registry);
    expect(code('E601')).toBe(8);
    expect(code('E604')).toBe(8);
  });

  it('maps a finding code the same way as an error', () => {
    expect(exitCodeOfCode('MFEFLOW_E114')).toBe(EXIT.project);
    expect(exitCodeOfCode('MFEFLOW_E301')).toBe(EXIT.build);
    expect(exitCodeOfCode('MFEFLOW_E501')).toBe(EXIT.deploy);
    expect(exitCodeOfCode('MFEFLOW_E107')).toBe(EXIT.usage);
    expect(exitCodeOfCode('MFEFLOW_E999')).toBe(EXIT.unexpected);
    expect(exitCodeOfCode('UNEXPECTED')).toBe(EXIT.unexpected);
  });

  it('keeps the numbers stable', () => {
    expect(EXIT).toEqual({
      ok: 0,
      unexpected: 1,
      usage: 2,
      project: 3,
      feature: 4,
      build: 5,
      registry: 6,
      deploy: 7,
      upgrade: 8,
      cancelled: 130,
    });
  });

  it('treats a cancel as 130 and anything else as unexpected', () => {
    expect(exitCodeFor(new Cancelled())).toBe(130);
    expect(exitCodeFor(new Error('boom'))).toBe(EXIT.unexpected);
    expect(exitCodeFor('text')).toBe(EXIT.unexpected);
  });

  it('reports code, message, fix and docs link', () => {
    const report = reportOf(new MfeflowError('E102', 'here'));
    expect(report.code).toBe('MFEFLOW_E102');
    expect(report.message).toBe('No mfeflow.json found: here');
    expect(report.fix).toContain('mfeflow project');
    expect(report.docs).toBe('https://mfeflow.github.io/mfeflow/errors/E102');
  });

  it('prints the message, and the stack only with --verbose', () => {
    const error = new Error('boom');
    expect(unexpectedText(error, false)).toContain('Unexpected error: boom');
    expect(unexpectedText(error, false)).toContain('--verbose');
    expect(unexpectedText(error, true)).toContain('Error: boom');
    expect(unexpectedText('plain', true)).toBe('plain');
  });
});
