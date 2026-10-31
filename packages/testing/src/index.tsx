import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import { composeProviders, type ProviderComponent } from '@mfeflow/runtime/providers';

export interface PlatformRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  /** The same list the shell passes to `composeProviders`, e.g. `[withProps(ThemeProvider, {...})]`. */
  providers?: readonly ProviderComponent[];
}

/** `render` from Testing Library, wrapped in the shell's providers. */
export function renderWithPlatform(
  ui: ReactElement,
  options: PlatformRenderOptions = {},
): RenderResult {
  const { providers = [], ...rest } = options;
  return render(ui, { ...rest, wrapper: composeProviders(providers) });
}

/**
 * Clears page-wide platform state between tests: web storage, the i18n
 * instance, the theme on `<html>`, and remote error reports.
 */
export function resetPlatform(): void {
  if (typeof localStorage !== 'undefined') localStorage.clear();
  if (typeof sessionStorage !== 'undefined') sessionStorage.clear();
  Reflect.deleteProperty(globalThis, 'mfeflowI18n');
  Reflect.deleteProperty(globalThis, 'mfeflowReports');
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    root.removeAttribute('style');
    root.removeAttribute('data-theme');
    root.removeAttribute('lang');
    root.removeAttribute('dir');
  }
}
