/**
 * The packages `@mfeflow/rsbuild` shares as singletons, by specifier. A test keeps this equal
 * to its `DEFAULT_SINGLETONS`; the CLI does not depend on the preset package at run time.
 */
export const SINGLETON_SPECIFIERS: readonly string[] = [
  'react',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  'react-dom',
  'react-dom/client',
  'react-router',
  '@tanstack/react-query',
  'i18next',
  'react-i18next',
  '@mfeflow/runtime',
  '@mfeflow/analytics',
  '@mfeflow/analytics/react',
  '@mfeflow/telemetry',
  '@mfeflow/event-bus',
  '@mfeflow/event-bus/react',
  '@mfeflow/storage',
  '@mfeflow/storage/react',
  '@mfeflow/theme',
  '@mfeflow/theme/react',
  '@mfeflow/i18n',
  '@mfeflow/i18n/react',
];

/** `react-dom/client` → `react-dom`, `@mfeflow/theme/react` → `@mfeflow/theme`. */
export function packageNameOf(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? specifier);
}

/** The singleton packages, each once. */
export const SINGLETON_PACKAGES: readonly string[] = [
  ...new Set(SINGLETON_SPECIFIERS.map(packageNameOf)),
];

/** The specifiers of a singleton package, for messages: `react` → react, react/jsx-runtime, … */
export function specifiersOf(name: string): string[] {
  return SINGLETON_SPECIFIERS.filter((s) => packageNameOf(s) === name);
}
