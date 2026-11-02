import { useState } from 'react';

export const Checkout = () => {
  const [placed, setPlaced] = useState(false);
  return (
    <section>
      <h2>Checkout</h2>
      <button type="button" onClick={() => setPlaced(true)}>
        {placed ? 'Order placed' : 'Place order'}
      </button>
    </section>
  );
};
