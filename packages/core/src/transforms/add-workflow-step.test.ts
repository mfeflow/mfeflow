import { describe, expect, it } from 'vitest';
import { thrown } from '../testing';
import { addWorkflowStep } from './add-workflow-step';

const workflow = `# CI
name: ci
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4 # pinned
      - name: Install
        run: pnpm install
      - name: Test
        run: pnpm test
`;

const run = (source: string, extra: object = {}) =>
  addWorkflowStep(source, 'ci.yml', {
    op: 'add-workflow-step',
    file: 'ci.yml',
    job: 'test',
    step: { name: 'Validate', run: 'pnpm mfeflow validate' },
    ...extra,
  });

describe('add-workflow-step', () => {
  it('appends the step to the job and keeps comments', () => {
    const out = run(workflow);
    expect(out).toBe(`${workflow}      - name: Validate
        run: pnpm mfeflow validate
`);
    expect(out).toContain('# CI');
    expect(out).toContain('# pinned');
  });

  it('inserts after a named step', () => {
    const out = run(workflow, { after: 'Install' });
    expect(out.indexOf('Validate')).toBeGreaterThan(out.indexOf('Install'));
    expect(out.indexOf('Validate')).toBeLessThan(out.indexOf('name: Test'));
  });

  it('writes uses/with/env/if steps in a stable key order, and multi-line scripts as blocks', () => {
    const out = run(workflow, {
      step: {
        env: { CI: '1' },
        with: { 'node-version': 22, cache: 'pnpm' },
        uses: 'actions/setup-node@v4',
        if: "github.event_name == 'push'",
        id: 'node',
        name: 'Node',
      },
    });
    expect(out).toContain(`      - name: Node
        id: node
        if: github.event_name == 'push'
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
        env:
          CI: "1"
`);
    expect(run(workflow, { step: { name: 'Two', run: 'a\nb\n' } })).toContain(
      'run: |\n          a\n          b',
    );
  });

  it('is idempotent and returns the source untouched when the step exists', () => {
    expect(run(workflow, { step: { name: 'Test', run: 'other' } })).toBe(workflow);
    const once = run(workflow);
    expect(run(once)).toBe(once);
  });

  it('fails with E208 on bad YAML, a missing job, or a missing anchor step', () => {
    expect(thrown(() => run('jobs: [')).code).toBe('MFEFLOW_E208');
    expect(thrown(() => run(workflow, { job: 'deploy' })).code).toBe('MFEFLOW_E208');
    expect(thrown(() => run(workflow, { after: 'Nope' })).code).toBe('MFEFLOW_E208');
  });

  describe('leaves the rest of the file exactly as it was', () => {
    it('keeps flow collections, quoting, long lines, blank lines and comments byte for byte', () => {
      const source = `# CI -- keep
name:   "ci"
on:
  push: { branches: [main, 'release/*'] }
env: {A: 1,   B: "two"}

jobs:
  test:
    runs-on: ubuntu-latest   # trailing spaces and comment
    steps:
      - uses: actions/checkout@v4

      - {name: Install,   run: pnpm install}
      - name: Long
        run: echo 'a very long line that the YAML library would normally fold at eighty columns, but must not here'
  other:
    runs-on: x
    steps: [ { name: S, run: s } ]
`;
      const out = run(source);
      expect(out.replace(/\n *- name: Validate\n *run: pnpm mfeflow validate/, '')).toBe(source);
      expect(out).toContain(
        `must not here'\n      - name: Validate\n        run: pnpm mfeflow validate\n  other:`,
      );
    });

    it('inserts a flow step into a flow list and a flow-style step into a block list', () => {
      const flow = `jobs:\n  test:\n    steps: [ { name: A, run: a }, { name: B, run: b } ]\n`;
      expect(run(flow)).toBe(
        `jobs:\n  test:\n    steps: [ { name: A, run: a }, { name: B, run: b }, { name: Validate, run: pnpm mfeflow validate } ]\n`,
      );
      expect(run(flow, { after: 'A' })).toBe(
        `jobs:\n  test:\n    steps: [ { name: A, run: a }, { name: Validate, run: pnpm mfeflow validate }, { name: B, run: b } ]\n`,
      );
      expect(run(`jobs:\n  test:\n    steps: []\n`)).toBe(
        `jobs:\n  test:\n    steps: [{ name: Validate, run: pnpm mfeflow validate }]\n`,
      );
      const mixed = `jobs:\n  test:\n    steps:\n      - { name: A, run: a }\n`;
      expect(run(mixed)).toBe(`${mixed}      - { name: Validate, run: pnpm mfeflow validate }\n`);
    });

    it('matches the list indentation, including a list level with its key', () => {
      const flush = `jobs:\n  test:\n    steps:\n    - name: A\n      run: a\n`;
      expect(run(flush)).toBe(`${flush}    - name: Validate\n      run: pnpm mfeflow validate\n`);
      const deep = `jobs:\n  test:\n      steps:\n          - name: A\n            run: a\n`;
      expect(run(deep)).toBe(
        `${deep}          - name: Validate\n            run: pnpm mfeflow validate\n`,
      );
    });

    it('inserts right after a multi-line step, ahead of the blank line before the next job', () => {
      const source = `jobs:\n  test:\n    steps:\n      - name: A\n        run: |\n          echo a\n          echo b\n\n  other:\n    runs-on: x\n`;
      expect(run(source)).toBe(
        `jobs:\n  test:\n    steps:\n      - name: A\n        run: |\n          echo a\n          echo b\n      - name: Validate\n        run: pnpm mfeflow validate\n\n  other:\n    runs-on: x\n`,
      );
    });

    it('keeps a comment on the last step line, and works without a final newline or with CRLF', () => {
      const commented = `jobs:\n  test:\n    steps:\n      - name: A # keep\n        run: a`;
      expect(run(commented)).toBe(
        `${commented}\n      - name: Validate\n        run: pnpm mfeflow validate`,
      );
      const crlf = workflow.replaceAll('\n', '\r\n');
      const out = run(crlf);
      expect(out.replaceAll('\r\n', '\n')).toBe(run(workflow));
      expect(out).not.toMatch(/[^\r]\n/);
    });

    it('still returns the source untouched when the step exists, in any style', () => {
      const flow = `jobs:\n  test:\n    steps: [ { name: Validate, run: x } ]\n`;
      expect(run(flow)).toBe(flow);
    });
  });
});
