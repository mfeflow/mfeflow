import { initI18n } from '@mfeflow/i18n';
import { defaultLanguage, languages, shellMessages } from './config';

/** The boot step: one i18next instance for the page, shared by the shell and every remote. */
export async function initShellI18n(): Promise<void> {
  await initI18n({ languages, defaultLanguage, resources: shellMessages });
}
