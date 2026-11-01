import type { LanguageOption } from '@mfeflow/i18n';

// Only used when this remote runs on its own (pnpm dev in its folder). Inside the shell, the shell's list wins.
export const languages: LanguageOption[] = [
  { code: 'en', label: 'English' },
  { code: 'ar', label: 'العربية' },
];

export const defaultLanguage = 'en';
