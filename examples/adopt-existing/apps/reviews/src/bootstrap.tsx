import { createRoot } from 'react-dom/client';
import { Reviews } from './Reviews';

const root = document.getElementById('root');
if (root) createRoot(root).render(<Reviews />);
