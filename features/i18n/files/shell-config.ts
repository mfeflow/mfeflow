import type { LanguageOption } from '@mfeflow/i18n';

export const languages: LanguageOption[] = [
  { code: 'en', label: 'English' },
  { code: 'ar', label: 'العربية' },
];

export const defaultLanguage = 'en';

// The shell's own messages ship with the shell. Remotes bring theirs (see their src/i18n folder).
export const shellMessages = {
  en: { shell: { language: 'Language' } },
  ar: { shell: { language: 'اللغة' } },
};
