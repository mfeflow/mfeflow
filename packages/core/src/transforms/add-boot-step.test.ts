import { describe, expect, it } from 'vitest';
import { thrown } from '../testing.js';
import { addBootStep } from './add-boot-step.js';

const bootstrap = `import { createRoot } from 'react-dom/client';
import { App } from './App';

export async function main(): Promise<void> {
  await initI18n();
  const el = document.getElementById('root');
  if (el) createRoot(el).render(<App />);
}
`;

const run = (source: string, extra: object = {}) =>
  addBootStep(source, 'bootstrap.tsx', {
    op: 'add-boot-step',
    file: 'bootstrap.tsx',
    call: 'initAnalytics',
    from: './platform/analytics',
    ...extra,
  });

describe('add-boot-step', () => {
  it('adds an awaited step before the statement that renders, and imports it', () => {
    expect(run(bootstrap, { args: ['gtm', 1, true] }))
      .toBe(`import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initAnalytics } from './platform/analytics';

export async function main(): Promise<void> {
  await initI18n();
  const el = document.getElementById('root');
  await initAnalytics('gtm', 1, true);
  if (el) createRoot(el).render(<App />);
}
`);
  });

  it('supports sync steps and default imports', () => {
    const out = run(bootstrap, { await: false, defaultImport: true });
    expect(out).toContain("import initAnalytics from './platform/analytics';");
    expect(out).toContain('  initAnalytics();\n  if (el)');
    expect(out).not.toContain('await initAnalytics');
  });

  it('inserts before or after a named step', () => {
    expect(run(bootstrap, { before: 'initI18n' })).toContain(
      '  await initAnalytics();\n  await initI18n();',
    );
    expect(run(bootstrap, { after: 'initI18n' })).toContain(
      '  await initI18n();\n  await initAnalytics();',
    );
  });

  it('appends to the end when there is no render, or fills an empty body', () => {
    const noRender = `export async function main() {\n  await a();\n}\n`;
    expect(run(noRender)).toContain('  await a();\n  await initAnalytics();\n}');
    expect(run(`export async function main() {}\n`)).toContain(
      'main() {\n  await initAnalytics();\n}',
    );
  });

  it('is idempotent', () => {
    for (const extra of [{}, { before: 'initI18n' }, { after: 'initI18n' }]) {
      const once = run(bootstrap, extra);
      expect(run(once, extra)).toBe(once);
    }
  });

  it('fails with E208 when the function, its body or the anchor step is missing', () => {
    expect(thrown(() => run('export const x = 1;\n')).code).toBe('MFEFLOW_E208');
    expect(thrown(() => run('export const main = () => 1;\n')).code).toBe('MFEFLOW_E208');
    expect(thrown(() => run(bootstrap, { before: 'nope' })).code).toBe('MFEFLOW_E208');
  });

  it('refuses to put an await into a function that is not async (E208)', () => {
    const sync = `export function main() {\n  setup();\n  createRoot(el).render(<App />);\n}\n`;
    const error = thrown(() => run(sync));
    expect(error.code).toBe('MFEFLOW_E208');
    expect(error.message).toContain('async');
    expect(error.message).toContain('main');
    const arrow = `export const main = () => {\n  setup();\n};\n`;
    expect(thrown(() => run(arrow)).code).toBe('MFEFLOW_E208');
  });

  it('allows a sync step in a sync function, and leaves it alone when the call is there already', () => {
    const sync = `export function main() {\n  setup();\n}\n`;
    expect(run(sync, { await: false })).toContain('  setup();\n  initAnalytics();\n}');
    const done = `export function main() {\n  initAnalytics();\n}\nimport { initAnalytics } from './platform/analytics';\n`;
    expect(run(done)).toBe(done);
  });

  describe('bodies that share a line with the braces', () => {
    const cases: [string, object, string][] = [
      [
        'async function main() { createRoot(el).render(<App />); }',
        {},
        'async function main() { await initAnalytics(); createRoot(el).render(<App />); }',
      ],
      [
        'async function main() { await setup(); createRoot(el).render(<App />); }',
        { before: 'setup' },
        'async function main() { await initAnalytics(); await setup(); createRoot(el).render(<App />); }',
      ],
      [
        'async function main() { await setup(); }',
        { after: 'setup' },
        'async function main() { await setup(); await initAnalytics(); }',
      ],
      [
        'async function main() { await setup(); }',
        {},
        'async function main() { await setup(); await initAnalytics(); }',
      ],
      [
        'async function main() {\n  await setup(); }',
        {},
        'async function main() {\n  await setup(); await initAnalytics(); }',
      ],
      [
        'async function main() { await setup(); /* done */ }',
        {},
        'async function main() { await setup(); await initAnalytics(); /* done */ }',
      ],
    ];

    it('inserts inside the body, never outside the closing brace', () => {
      for (const [source, extra, expected] of cases) {
        const out = run(source, extra).replace(/^import .*\n+/, '');
        expect(out, source).toBe(expected);
      }
    });

    it('stays idempotent and parseable', () => {
      for (const [source, extra] of cases) {
        const once = run(source, extra);
        expect(run(once, extra), source).toBe(once);
      }
    });
  });
});
