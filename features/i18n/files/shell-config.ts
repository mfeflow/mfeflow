import type { LanguageOption } from '@mfeflow/i18n';

export const languages: LanguageOption[] = [
  { code: 'en', label: 'English' },
  { code: 'ar', label: 'العربية' },
];

export const defaultLanguage = 'en';

// The shell's own messages ship with the shell. Remotes bring theirs (see their src/i18n folder).
export const shellMessages: Record<string, { shell: Record<string, string> }> = {
  en: { shell: { language: 'Language' } },
  ar: { shell: { language: 'اللغة' } },
};

/** The messages of one language, or the default language's when this one has none, so the text never goes blank. */
export function loadShellMessages(language: string): Promise<Record<string, string>> {
  const found = shellMessages[language] ?? shellMessages[defaultLanguage];
  return Promise.resolve(found?.shell ?? {});
}
