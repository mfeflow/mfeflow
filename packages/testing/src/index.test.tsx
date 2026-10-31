import { cleanup, screen } from '@testing-library/react';
import { createContext, useContext, type ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { withProps } from '@mfeflow/runtime';
import { renderWithPlatform, resetPlatform } from '.';

afterEach(cleanup);

const Tenant = createContext('none');

function TenantProvider({ value, children }: { value: string; children?: ReactNode }) {
  return <Tenant.Provider value={value}>{children}</Tenant.Provider>;
}

function ShowTenant() {
  return <span data-testid="tenant">{useContext(Tenant)}</span>;
}

describe('renderWithPlatform', () => {
  it('wraps the component in the given providers', () => {
    renderWithPlatform(<ShowTenant />, {
      providers: [withProps(TenantProvider, { value: 'acme' })],
    });
    expect(screen.getByTestId('tenant').textContent).toBe('acme');
  });

  it('works without providers', () => {
    renderWithPlatform(<ShowTenant />);
    expect(screen.getByTestId('tenant').textContent).toBe('none');
  });
});

describe('resetPlatform', () => {
  it('clears storage, globals and <html> attributes', () => {
    localStorage.setItem('shell:theme', '"dark"');
    sessionStorage.setItem('x', '1');
    Reflect.set(globalThis, 'mfeflowI18n', {});
    Reflect.set(globalThis, 'mfeflowReports', [{}]);
    const root = document.documentElement;
    root.dataset.theme = 'dark';
    root.lang = 'ar';
    root.dir = 'rtl';
    root.style.setProperty('--mf-x', '1');
    resetPlatform();
    expect(localStorage.length + sessionStorage.length).toBe(0);
    expect(Reflect.has(globalThis, 'mfeflowI18n')).toBe(false);
    expect(Reflect.has(globalThis, 'mfeflowReports')).toBe(false);
    expect(root.getAttribute('data-theme')).toBeNull();
    expect(root.getAttribute('dir')).toBeNull();
    expect(root.style.getPropertyValue('--mf-x')).toBe('');
  });
});

describe('runtime import', () => {
  it('uses the providers subpath, so Module Federation is not pulled into test runs', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(`${import.meta.dirname}/index.tsx`, 'utf8');
    expect(source).toContain("from '@mfeflow/runtime/providers'");
    expect(source).not.toMatch(/from '@mfeflow\/runtime'/);
  });
});
