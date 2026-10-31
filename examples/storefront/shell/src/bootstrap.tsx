import { createRoot } from 'react-dom/client';
import { initI18n } from '@mfeflow/i18n';
import {
  applyDevOverrides,
  assertRequested,
  loadRegistryIndex,
  registerRemotesFromIndex,
  reportRemoteError,
} from '@mfeflow/runtime';
import { App } from './App';
import { languages, shellMessages } from './languages';
import './styles.css';

const DEV = process.env.NODE_ENV !== 'production';

export async function main(): Promise<void> {
  await initI18n({ languages, defaultLanguage: 'en', resources: shellMessages, detect: false });
  try {
    // Overrides need the manifest loader, which production builds leave out:
    // ?mfe-override=cart@http://localhost:4312/mf-manifest.json
    const index = applyDevOverrides(await loadRegistryIndex(), { enabled: DEV });
    const overrides = index.remotes
      .filter((r) => r.version === 'override')
      .map((r) => new URL(r.entry).origin);
    registerRemotesFromIndex(index, { allowedOrigins: [location.origin, ...overrides] });
  } catch (error) {
    reportRemoteError('storefront', 'registry', error);
  }
  const el = document.getElementById('root');
  if (el) createRoot(el).render(<App />);
  if (DEV || assertRequested()) void import('./assert');
}
