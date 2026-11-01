import { createRoot } from 'react-dom/client';
import { Checkout } from './Checkout';

const root = document.getElementById('root');
if (root) createRoot(root).render(<Checkout />);
