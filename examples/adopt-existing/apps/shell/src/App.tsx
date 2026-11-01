import { lazy, Suspense } from 'react';

const ProductList = lazy(() =>
  import('catalog/ProductList').then((m) => ({ default: m.ProductList })),
);
const Checkout = lazy(() => import('checkout/Checkout').then((m) => ({ default: m.Checkout })));

export function App() {
  return (
    <main>
      <h1>Plain shop</h1>
      <Suspense fallback={<p>Loading catalog...</p>}>
        <ProductList />
      </Suspense>
      <Suspense fallback={<p>Loading checkout...</p>}>
        <Checkout />
      </Suspense>
    </main>
  );
}
