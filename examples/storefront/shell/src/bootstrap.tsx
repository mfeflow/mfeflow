import { StrictMode } from 'react';
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
import { configureShellEvents } from './events';
import { startPlatform } from './platform';
import { languages, shellMessages } from './languages';
import './styles.css';

declare global {
  var mfeflowAssertReady: Promise<void> | undefined;
}

const DEV = process.env.NODE_ENV !== 'production';

export async function main(): Promise<void> {
  configureShellEvents();
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
  if (el)
    createRoot(el).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  // After first render: analytics and telemetry never delay it.
  void startPlatform();
  // Off the critical path; resolves once the check is installed, for tests that need to call it.
  if (DEV || assertRequested()) globalThis.mfeflowAssertReady = import('./assert').then(() => {});
}
