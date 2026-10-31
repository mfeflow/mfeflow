import { describe, expect, it } from 'vitest';
import { thrown } from '../testing';
import { wrapProvider } from './wrap-provider';

const providers = `import { type ReactNode } from 'react';
import { ThemeProvider } from '@mfeflow/theme';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      {/* keep this comment */}
      {children}
    </ThemeProvider>
  );
}
`;

const run = (source: string, extra: object = {}) =>
  wrapProvider(source, 'providers.tsx', {
    op: 'wrap-provider',
    file: 'providers.tsx',
    component: 'ConsentProvider',
    from: './platform/consent',
    ...extra,
  });

describe('wrap-provider', () => {
  it('wraps the returned JSX and imports the provider', () => {
    expect(
      run(providers, { props: { mode: 'denied', debug: true, max: 2, off: false, tag: 'a"b' } }),
    ).toBe(`import { type ReactNode } from 'react';
import { ThemeProvider } from '@mfeflow/theme';
import { ConsentProvider } from './platform/consent';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ConsentProvider mode="denied" debug max={2} off={false} tag={"a\\"b"}>
      <ThemeProvider>
        {/* keep this comment */}
        {children}
      </ThemeProvider>
    </ConsentProvider>
  );
}
`);
  });

  it('works with an arrow function component and a default import', () => {
    const source = `export const Providers = ({ children }) => <A>{children}</A>;\n`;
    expect(run(source, { defaultImport: true })).toBe(
      `import ConsentProvider from './platform/consent';\n\nexport const Providers = ({ children }) => <ConsentProvider>\n  <A>{children}</A>\n</ConsentProvider>;\n`,
    );
  });

  it('wraps a fragment and honours a different function name', () => {
    const source = `export function Root() {\n  return <>{null}</>;\n}\n`;
    expect(run(source, { function: 'Root' })).toContain(
      '<ConsentProvider>\n    <>{null}</>\n  </ConsentProvider>',
    );
  });

  it('is idempotent', () => {
    const once = run(providers);
    expect(run(once)).toBe(once);
  });

  it('fails with E208 when the function or its JSX is missing', () => {
    expect(thrown(() => run('export const x = 1;\n')).code).toBe('MFEFLOW_E208');
    expect(thrown(() => run('export function Providers() {\n  return null;\n}\n')).code).toBe(
      'MFEFLOW_E208',
    );
  });
});
