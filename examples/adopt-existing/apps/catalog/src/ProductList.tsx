const products = [
  { id: 'kettle', name: 'Steel kettle', price: 28 },
  { id: 'mug', name: 'Stoneware mug', price: 12 },
];

export const ProductList = () => (
  <section>
    <h2>Catalog</h2>
    <ul>
      {products.map((product) => (
        <li key={product.id}>
          {product.name}: ${product.price}
        </li>
      ))}
    </ul>
  </section>
);
