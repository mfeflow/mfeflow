import { useMfeTranslation } from '@mfeflow/i18n/react';
import { useStoredState } from '@mfeflow/storage/react';
import { cssVar } from '@mfeflow/theme';
import { loadMessages } from '../i18n/load';
import { cartStorage, isItems } from '../store';

export default function CartApp() {
  const { t, ready } = useMfeTranslation('cart', loadMessages);
  const [items, setItems] = useStoredState<string[]>(cartStorage, 'items', [], isItems);
  if (!ready) return <p>…</p>;
  return (
    <section data-testid="cart">
      <h1>{t('heading')}</h1>
      {items.length === 0 ? (
        <p>{t('empty')}</p>
      ) : (
        <ul>
          {items.map((item, i) => (
            <li key={`${item}-${String(i)}`}>{item}</li>
          ))}
        </ul>
      )}
      <button
        type="button"
        data-testid="cart-add"
        onClick={() => setItems((prev) => [...prev, `item ${String(prev.length + 1)}`])}
        style={{ background: cssVar('color-primary'), color: cssVar('color-bg') }}
      >
        {t('add')}
      </button>
    </section>
  );
}
