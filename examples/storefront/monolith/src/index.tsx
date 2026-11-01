import { lazy, Suspense, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AnalyticsProvider } from '@mfeflow/analytics/react';
import { initI18n } from '@mfeflow/i18n';
import { composeProviders, withProps } from '@mfeflow/runtime';
import { ThemeProvider } from '@mfeflow/theme/react';
import { languages, shellMessages } from '../../shell/src/languages';
import { startPlatform } from '../../shell/src/platform';
import { themes } from '../../shell/src/themes';
import '../../shell/src/styles.css';

const Catalog = lazy(() => import('../../catalog/src/exposed/App'));
const Cart = lazy(() => import('../../cart/src/exposed/App'));
const MiniCart = lazy(() => import('../../cart/src/exposed/MiniCart'));

const Providers = composeProviders([
  withProps(ThemeProvider, { themes, defaultTheme: 'light', followSystem: false }),
]);

function App() {
  const [path] = useState(location.pathname);
  return (
    <AnalyticsProvider>
      <Providers>
        <header>
          <strong>Storefront</strong>
          <Suspense fallback={null}>
            <MiniCart />
          </Suspense>
        </header>
        <main>
          <Suspense fallback={<p>…</p>}>
            {path.startsWith('/cart') ? <Cart /> : <Catalog />}
          </Suspense>
        </main>
      </Providers>
    </AnalyticsProvider>
  );
}

async function main(): Promise<void> {
  await initI18n({ languages, defaultLanguage: 'en', resources: shellMessages, detect: false });
  const el = document.getElementById('root');
  if (el) createRoot(el).render(<App />);
  void startPlatform();
}

void main();
