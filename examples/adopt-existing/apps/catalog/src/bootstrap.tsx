import { createRoot } from 'react-dom/client';
import { ProductList } from './ProductList';

const root = document.getElementById('root');
if (root) createRoot(root).render(<ProductList />);
