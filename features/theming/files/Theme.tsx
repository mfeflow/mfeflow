import type { ReactNode } from 'react';
import { ThemeProvider } from '@mfeflow/theme/react';
import { ThemeToggle } from './ThemeToggle';
import { defaultTheme, themes } from './themes';
import './theme.css';

/** Wraps the shell. The choice is stored under the shell's storage, so every tab and reload agrees. */
export function Theme({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider themes={themes} defaultTheme={defaultTheme}>
      {children}
      <ThemeToggle />
    </ThemeProvider>
  );
}
