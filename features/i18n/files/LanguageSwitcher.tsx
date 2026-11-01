import { useLanguage, useMfeTranslation } from '@mfeflow/i18n/react';
import { shellMessages } from './config';

// The shell's messages are bundled, so nothing is loaded here.
const noLoad = () => Promise.resolve(shellMessages);

/** Your component: move it into the header or restyle it. Changing the language also sets <html lang dir>. */
export function LanguageSwitcher() {
  const { t } = useMfeTranslation('shell', noLoad);
  const { language, languages, setLanguage } = useLanguage();
  return (
    <label
      className="language-switcher"
      style={{ position: 'fixed', left: '1rem', bottom: '1rem' }}
    >
      {t('language')}{' '}
      <select
        value={language}
        onChange={(event) => {
          void setLanguage(event.target.value);
        }}
      >
        {languages.map((option) => (
          <option key={option.code} value={option.code}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
