import { useTrackOnMount } from '@mfeflow/analytics/react';
import { useMfeTranslation } from '@mfeflow/i18n/react';
import { useStoredState } from '@mfeflow/storage/react';
import { tracker } from '../analytics';
import { useItemAdded } from '../events';
import { loadMessages } from '../i18n/load';
import { cartStorage, isItems } from '../store';

export default function MiniCart() {
  const { t, ready } = useMfeTranslation('cart', loadMessages);
  useTrackOnMount(tracker, 'mini_cart_viewed');
  const [items, setItems] = useStoredState<string[]>(cartStorage, 'items', [], isItems);
  // The mini cart is in the shell on every page, so it is the one place that listens: the cart page reads the same storage.
  useItemAdded((sku) => {
    setItems((prev) => [...prev, sku]);
  });
  return <span data-testid="mini-cart">{ready ? t('items', { count: items.length }) : '…'}</span>;
}
