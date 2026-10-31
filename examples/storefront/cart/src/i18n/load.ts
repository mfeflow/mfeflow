import type { NamespaceLoader } from '@mfeflow/i18n';

// Each language is its own chunk, served from this remote's deploy.
export const loadMessages: NamespaceLoader = (language) => import(`./${language}.json`);
