import type { LanguageOption } from '@mfeflow/i18n';

/** The languages the apps are translated into. Each label is written in its own language. */
export const languages: readonly LanguageOption[] = Object.freeze([
  Object.freeze({ code: 'en', label: 'English' }),
  Object.freeze({ code: 'es', label: 'Español' }),
]);

/** Used when nothing is stored and the browser asks for a language we do not have. Must be one of `languages`. */
export const defaultLanguage = 'en';

/**
 * The namespaces an app may load: `common` for text every app shares, then one per remote, named like the remote.
 * Add yours.
 */
export const namespaces = ['common', 'errors'] as const;
export type Namespace = (typeof namespaces)[number];
