import { useTheme } from '@mfeflow/theme/react';

/** Your component: move it into the header, restyle it, or swap it for a menu. */
export function ThemeToggle() {
  const { theme, themes, setTheme } = useTheme();
  return (
    <label className="theme-toggle">
      Theme{' '}
      <select
        value={theme.name}
        onChange={(event) => {
          setTheme(event.target.value);
        }}
      >
        {themes.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
}
