import { useEffect, useState, type MouseEvent } from 'react';
import { useLanguage, useMfeTranslation } from '@mfeflow/i18n/react';
import { composeProviders, DevOverlay, RemoteBoundary, withProps } from '@mfeflow/runtime';
import { ThemeProvider, useTheme } from '@mfeflow/theme/react';
import { themes } from './themes';

const Providers = composeProviders([
  withProps(ThemeProvider, { themes, defaultTheme: 'light', followSystem: false }),
]);

// Shell messages ship with the shell (initI18n resources), so the loader is never called.
const noLoad = () => Promise.resolve({});

function usePath(): [string, (e: MouseEvent<HTMLAnchorElement>) => void] {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const on = () => {
      setPath(location.pathname);
    };
    addEventListener('popstate', on);
    return () => {
      removeEventListener('popstate', on);
    };
  }, []);
  const go = (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    history.pushState(null, '', e.currentTarget.href);
    setPath(location.pathname);
  };
  return [path, go];
}

function Header({ go }: { go: (e: MouseEvent<HTMLAnchorElement>) => void }) {
  const { t } = useMfeTranslation('shell', noLoad);
  const { theme, themes: names, setTheme } = useTheme();
  const { language, languages, setLanguage } = useLanguage();
  return (
    <header>
      <strong>{t('title')}</strong>
      <nav>
        <a href="/catalog" onClick={go} data-testid="nav-catalog">
          {t('catalog')}
        </a>
        <a href="/cart" onClick={go} data-testid="nav-cart">
          {t('cart')}
        </a>
      </nav>
      <label>
        {t('theme')}{' '}
        <select data-testid="theme" value={theme.name} onChange={(e) => setTheme(e.target.value)}>
          {names.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t('language')}{' '}
        <select
          data-testid="language"
          value={language}
          onChange={(e) => void setLanguage(e.target.value)}
        >
          {languages.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </select>
      </label>
      <RemoteBoundary id="cart/MiniCart" timeoutMs={4000} />
    </header>
  );
}

export function App() {
  const [path, go] = usePath();
  return (
    <Providers>
      <Header go={go} />
      <main>
        {path.startsWith('/cart') ? (
          <RemoteBoundary id="cart/App" loading={<p>…</p>} />
        ) : (
          <RemoteBoundary id="catalog/App" loading={<p>…</p>} />
        )}
      </main>
      <DevOverlay enabled={location.hostname === 'localhost'} />
    </Providers>
  );
}
