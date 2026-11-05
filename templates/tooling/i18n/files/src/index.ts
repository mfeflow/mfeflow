import { initI18n, loadNamespace, type I18n, type InitI18nOptions } from '@mfeflow/i18n';
import { defaultLanguage, languages, type Namespace } from './defaults';

export * from '@mfeflow/i18n';
export { defaultLanguage, languages, namespaces, type Namespace } from './defaults';

/** The options for `initI18n` with the company's languages and default, and whatever you pass on top. */
export function i18nOptions(overrides: Partial<InitI18nOptions> = {}): InitI18nOptions {
  return { languages, defaultLanguage, ...overrides };
}

/** Creates the page's i18next instance with the company's languages. Call it once, in the shell. */
export function startI18n(overrides: Partial<InitI18nOptions> = {}): Promise<I18n> {
  return initI18n(i18nOptions(overrides));
}

type LoadArgs = Parameters<typeof loadNamespace>;

/** `loadNamespace` for a namespace in the company's list, so a misspelt one fails typecheck. */
export function loadCompanyNamespace(
  instance: LoadArgs[0],
  namespace: Namespace,
  loader: LoadArgs[2],
  language?: LoadArgs[3],
): Promise<void> {
  return loadNamespace(instance, namespace, loader, language);
}
