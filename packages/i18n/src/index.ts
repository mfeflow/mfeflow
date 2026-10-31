import { createInstance, type i18n as I18n, type Resource } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { createStorage, type MfeStorage } from '@mfeflow/storage';

export type { I18n };

export interface LanguageOption {
  /** BCP 47 code, e.g. `en`, `hi`, `ar`, `pt-BR`. */
  code: string;
  /** Shown in language pickers, in that language: `English`, `हिन्दी`, `العربية`. */
  label: string;
}

export interface InitI18nOptions {
  languages: readonly LanguageOption[];
  defaultLanguage: string;
  /** Messages the shell ships up front. Remotes load their own with `loadNamespace`. */
  resources?: Resource;
  /** Use the browser's languages when nothing is stored. Default true. */
  detect?: boolean;
  /** Defaults to the shell's storage. */
  storage?: MfeStorage;
  /** Gets `lang` and `dir`. Defaults to `<html>`. */
  root?: HTMLElement;
}

export const LANGUAGE_STORAGE_KEY = 'language';

interface I18nState {
  instance: I18n;
  languages: readonly LanguageOption[];
}

declare global {
  // One instance per page, shared by the shell and every remote.
  var mfeflowI18n: I18nState | undefined;
}

/** Stored choice, then the first browser language we support (exact or base), then the default. */
export function detectLanguage(
  supported: readonly string[],
  stored: string | undefined,
  preferred: readonly string[],
  fallback: string,
): string {
  if (stored !== undefined && supported.includes(stored)) return stored;
  for (const lang of preferred) {
    if (supported.includes(lang)) return lang;
    const base = lang.split('-')[0];
    if (base !== undefined && supported.includes(base)) return base;
  }
  return fallback;
}

function browserLanguages(): readonly string[] {
  return typeof navigator === 'undefined' ? [] : navigator.languages;
}

function applyDocumentLanguage(instance: I18n, root: HTMLElement | undefined, lng: string): void {
  const el = root ?? (typeof document === 'undefined' ? undefined : document.documentElement);
  if (!el) return;
  el.lang = lng;
  el.dir = instance.dir(lng);
}

/**
 * Creates the page's single i18next instance. Call once, in the shell, before
 * rendering. Calling it again returns the existing instance.
 */
export async function initI18n(options: InitI18nOptions): Promise<I18n> {
  if (globalThis.mfeflowI18n) return globalThis.mfeflowI18n.instance;
  const codes = options.languages.map((l) => l.code);
  if (!codes.includes(options.defaultLanguage)) {
    throw new Error(`Default language "${options.defaultLanguage}" is not in the language list`);
  }
  const storage = options.storage ?? createStorage('shell');
  const stored = storage.get<string | undefined>(
    LANGUAGE_STORAGE_KEY,
    undefined,
    (v): v is string => typeof v === 'string',
  );
  const lng = detectLanguage(
    codes,
    stored,
    options.detect === false ? [] : browserLanguages(),
    options.defaultLanguage,
  );

  const instance = createInstance();
  await instance.use(initReactI18next).init({
    lng,
    fallbackLng: options.defaultLanguage,
    supportedLngs: codes,
    resources: options.resources ?? {},
    partialBundledLanguages: true,
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
  applyDocumentLanguage(instance, options.root, lng);
  instance.on('languageChanged', (next) => {
    applyDocumentLanguage(instance, options.root, next);
    storage.set(LANGUAGE_STORAGE_KEY, next);
  });
  globalThis.mfeflowI18n = { instance, languages: options.languages };
  return instance;
}

/** The page's i18next instance. Throws if the shell has not called `initI18n`. */
export function getI18n(): I18n {
  const state = globalThis.mfeflowI18n;
  if (!state)
    throw new Error('getI18n: the shell must call initI18n() before remotes use translations');
  return state.instance;
}

/** Languages the shell configured. */
export function getLanguages(): readonly LanguageOption[] {
  return globalThis.mfeflowI18n?.languages ?? [];
}

export type Messages = Readonly<Record<string, unknown>>;
/** Usually `(lng) => import(`./i18n/${lng}.json`)`, so messages ship with the remote's own deploy. */
export type NamespaceLoader = (language: string) => Promise<unknown>;

function isMessages(value: unknown): value is Messages {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unwrap(mod: unknown): Messages {
  if (isMessages(mod) && 'default' in mod && isMessages(mod.default)) return mod.default;
  if (isMessages(mod)) return mod;
  throw new Error('loadNamespace: the loader must resolve to an object of messages');
}

/**
 * Adds a remote's namespace for `language` if it is not loaded yet. If that
 * language fails to load, the fallback language is loaded instead so the
 * remote still renders text.
 */
export async function loadNamespace(
  instance: I18n,
  namespace: string,
  loader: NamespaceLoader,
  language: string = instance.language,
): Promise<void> {
  if (instance.hasResourceBundle(language, namespace)) return;
  try {
    instance.addResourceBundle(language, namespace, unwrap(await loader(language)), true, false);
  } catch (error) {
    const configured: unknown = instance.options.fallbackLng;
    const first: unknown = Array.isArray(configured) ? configured[0] : configured;
    const fallback = typeof first === 'string' ? first : undefined;
    if (
      fallback === undefined ||
      fallback === language ||
      instance.hasResourceBundle(fallback, namespace)
    )
      throw error;
    instance.addResourceBundle(fallback, namespace, unwrap(await loader(fallback)), true, false);
  }
}

/** Only for tests: forget the page's instance. */
export function resetI18nForTests(): void {
  globalThis.mfeflowI18n = undefined;
}
