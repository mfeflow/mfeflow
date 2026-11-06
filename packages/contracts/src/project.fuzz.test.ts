import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { shellSourceProblem, validateMfeflowProject } from './project';

describe('shellSourceProblem fuzz', () => {
  it('answers with text or nothing and never throws, for any text', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), (value) => {
        const problem = shellSourceProblem(value);
        expect(problem === undefined || typeof problem === 'string').toBe(true);
      }),
      { numRuns: 500 },
    );
  });

  it('never accepts an empty, padded or NUL-holding value', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), (value) => {
        if (value.trim() !== value || value === '' || value.includes('\0')) {
          expect(shellSourceProblem(value)).toBeDefined();
        }
      }),
      { numRuns: 500 },
    );
  });

  it('never accepts a web URL that carries credentials', () => {
    const word = fc.stringMatching(/^[a-z0-9]{1,8}$/);
    fc.assert(
      fc.property(word, word, word, (user, pass, host) => {
        expect(shellSourceProblem(`https://${user}:${pass}@${host}.example.com/`)).toBeDefined();
      }),
      { numRuns: 100 },
    );
  });

  it('never accepts a web URL with a secret in the query', () => {
    const name = fc.constantFrom('token', 'api_key', 'sig', 'password', 'secret');
    fc.assert(
      fc.property(name, fc.stringMatching(/^[a-z0-9]{6,12}$/), (key, value) => {
        expect(shellSourceProblem(`https://shell.example.com/?${key}=${value}`)).toBeDefined();
      }),
      { numRuns: 100 },
    );
  });

  it('never accepts plain http outside localhost', () => {
    const host = fc.stringMatching(/^[a-z]{3,10}$/).filter((h) => h !== 'localhost');
    fc.assert(
      fc.property(host, (name) => {
        expect(shellSourceProblem(`http://${name}.example.com/`)).toBeDefined();
      }),
      { numRuns: 100 },
    );
  });
});

describe('validateMfeflowProject fuzz', () => {
  it('returns well-formed issues and never throws, for any JSON value', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const issues = validateMfeflowProject(value);
        for (const issue of issues) {
          expect(typeof issue.path).toBe('string');
          expect(typeof issue.message).toBe('string');
        }
      }),
      { numRuns: 500 },
    );
  });

  it('reports at least one issue for anything that is not an object', () => {
    const notObject = fc.oneof(
      fc.string(),
      fc.integer(),
      fc.boolean(),
      fc.constant(null),
      fc.array(fc.jsonValue()),
    );
    fc.assert(
      fc.property(notObject, (value) => {
        expect(validateMfeflowProject(value).length).toBeGreaterThan(0);
      }),
      { numRuns: 200 },
    );
  });

  it('survives objects shaped like a project but filled with junk', () => {
    const junk = fc.jsonValue();
    fc.assert(
      fc.property(junk, junk, junk, junk, junk, (cli, repo, shell, apps, features) => {
        const issues = validateMfeflowProject({ version: 1, cli, repo, shell, apps, features });
        expect(Array.isArray(issues)).toBe(true);
      }),
      { numRuns: 300 },
    );
  });
});
