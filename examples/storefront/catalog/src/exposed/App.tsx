import { useMemo } from 'react';
import { useTrackOnMount } from '@mfeflow/analytics/react';
import { useMfeTranslation } from '@mfeflow/i18n/react';
import { createStorage } from '@mfeflow/storage';
import { useStoredState } from '@mfeflow/storage/react';
import { cssVar } from '@mfeflow/theme';
import { tracker } from '../analytics';
import { addToCart } from '../events';
import { loadMessages } from '../i18n/load';

const ids = ['1', '2', '3'];

export default function CatalogApp() {
  const { t, ready } = useMfeTranslation('catalog', loadMessages);
  useTrackOnMount(tracker, 'catalog_viewed');
  const storage = useMemo(() => createStorage('catalog'), []);
  const [lastViewed, setLastViewed] = useStoredState<string | null>(storage, 'lastViewed', null);
  if (!ready) return <p>…</p>;
  return (
    <section data-testid="catalog">
      <h1 data-testid="catalog-heading">{t('heading')}</h1>
      <ul style={{ display: 'flex', gap: '1rem', listStyle: 'none', padding: 0 }}>
        {ids.map((id) => (
          <li
            key={id}
            data-testid={`product-${id}`}
            style={{ background: cssVar('color-surface'), padding: '1rem', borderRadius: '8px' }}
          >
            <p>{t(`products.${id}`)}</p>
            <button
              type="button"
              onClick={() => {
                setLastViewed(id);
                addToCart(id);
              }}
              style={{ color: cssVar('color-primary') }}
            >
              {t('add')}
            </button>
            {lastViewed === id ? ' ✓' : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
