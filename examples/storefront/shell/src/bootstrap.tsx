import { createRoot } from 'react-dom/client';
import { initI18n } from '@mfeflow/i18n';
import {
  applyDevOverrides,
  checkSingletons,
  loadRegistryIndex,
  registerRemotesFromIndex,
  reportRemoteError,
} from '@mfeflow/runtime';
import { App } from './App';
import { languages, shellMessages } from './languages';
import './styles.css';

const SINGLETONS = [
  'react',
  'react-dom',
  'i18next',
  'react-i18next',
  '@mfeflow/runtime',
  '@mfeflow/storage',
  '@mfeflow/theme',
  '@mfeflow/i18n',
];

declare global {
  var mfeflowCheckSingletons: (() => ReturnType<typeof checkSingletons>) | undefined;
}

async function main(): Promise<void> {
  await initI18n({ languages, defaultLanguage: 'en', resources: shellMessages, detect: false });
  try {
    // Dev overrides only on localhost: ?mfe-override=cart@http://localhost:4312/mf-manifest.json
    const index = applyDevOverrides(await loadRegistryIndex('/registry/index.json'), {
      enabled: location.hostname === 'localhost',
    });
    const overrides = index.remotes
      .filter((r) => r.version === 'override')
      .map((r) => new URL(r.entry).origin);
    registerRemotesFromIndex(index, {
      allowedOrigins: [`${location.protocol}//${location.hostname}:4301`, ...overrides],
    });
  } catch (error) {
    reportRemoteError('storefront', 'registry', error);
  }
  globalThis.mfeflowCheckSingletons = () => checkSingletons(SINGLETONS);
  const el = document.getElementById('root');
  if (el) createRoot(el).render(<App />);
}

void main();
