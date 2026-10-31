import { createRoot } from 'react-dom/client';
import { initI18n } from '@mfeflow/i18n';
import App from './exposed/App';

// Standalone mode (rsbuild dev in this folder). Inside the shell, only ./exposed/* is loaded.
async function main(): Promise<void> {
  await initI18n({
    languages: [{ code: 'en', label: 'English' }],
    defaultLanguage: 'en',
    detect: false,
  });
  const el = document.getElementById('root');
  if (el) createRoot(el).render(<App />);
}

void main();
