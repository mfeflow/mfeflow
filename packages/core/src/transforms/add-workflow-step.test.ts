import { describe, expect, it } from 'vitest';
import { thrown } from '../testing.js';
import { addWorkflowStep } from './add-workflow-step.js';

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
});
