import type { NamespaceLoader } from '@mfeflow/i18n';

// Each language is its own chunk, served from this remote's deploy and versioned with it.
export const loadMessages: NamespaceLoader = (language) => import(`./messages/${language}.json`);
