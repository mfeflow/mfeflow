import { useTrackOnMount } from '@mfeflow/analytics/react';
import { useMfeTranslation } from '@mfeflow/i18n/react';
import { useStoredState } from '@mfeflow/storage/react';
import { tracker } from '../analytics';
import { loadMessages } from '../i18n/load';
import { cartStorage, isItems } from '../store';

export default function MiniCart() {
  const { t, ready } = useMfeTranslation('cart', loadMessages);
  useTrackOnMount(tracker, 'mini_cart_viewed');
  const [items] = useStoredState<string[]>(cartStorage, 'items', [], isItems);
  return <span data-testid="mini-cart">{ready ? t('items', { count: items.length }) : '…'}</span>;
}
