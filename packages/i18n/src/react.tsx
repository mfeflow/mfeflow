import { useCallback, useEffect, useEffectEvent, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { getI18n, getLanguages, loadNamespace, type LanguageOption, type NamespaceLoader } from '.';

export interface MfeTranslation {
  t: TFunction;
  /** False until the namespace for the current language has loaded. */
  ready: boolean;
  language: string;
}

/**
 * Translations for one remote. Loads `namespace` with `loader` for the current
 * language when the component mounts, and again whenever the language changes.
 */
export function useMfeTranslation(namespace: string, loader: NamespaceLoader): MfeTranslation {
  const i18n = getI18n();
  const { t } = useTranslation(namespace, { i18n, useSuspense: false });
  // Always calls the latest loader without re-running the effect when callers pass an inline function.
  const loadWith = useEffectEvent((lng: string) => loadNamespace(i18n, namespace, loader, lng));
  const [ready, setReady] = useState(() => i18n.hasResourceBundle(i18n.language, namespace));
  const [language, setLanguage] = useState(i18n.language);

  useEffect(() => {
    let alive = true;
    const load = (lng: string) => {
      setLanguage(lng);
      setReady(i18n.hasResourceBundle(lng, namespace));
      loadWith(lng).then(
        () => {
          if (alive) setReady(true);
        },
        (error: unknown) => {
          console.error(`[mfeflow/i18n] could not load namespace "${namespace}"`, error);
          if (alive) setReady(true);
        },
      );
    };
    load(i18n.language);
    i18n.on('languageChanged', load);
    return () => {
      alive = false;
      i18n.off('languageChanged', load);
    };
  }, [i18n, namespace]);

  return { t, ready, language };
}

export interface LanguageState {
  language: string;
  languages: readonly LanguageOption[];
  setLanguage: (code: string) => Promise<void>;
}

/** The current language, the configured list, and a setter, for language pickers. */
export function useLanguage(): LanguageState {
  const i18n = getI18n();
  const subscribe = useCallback(
    (onChange: () => void) => {
      i18n.on('languageChanged', onChange);
      return () => {
        i18n.off('languageChanged', onChange);
      };
    },
    [i18n],
  );
  const language = useSyncExternalStore(
    subscribe,
    () => i18n.language,
    () => i18n.language,
  );
  const setLanguage = useCallback(
    async (code: string) => {
      if (!getLanguages().some((l) => l.code === code))
        throw new Error(`Unknown language "${code}"`);
      await i18n.changeLanguage(code);
    },
    [i18n],
  );
  return { language, languages: getLanguages(), setLanguage };
}
