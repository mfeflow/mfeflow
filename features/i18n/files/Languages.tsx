import type { ReactNode } from 'react';
import { LanguageSwitcher } from './LanguageSwitcher';

/** Wraps the shell and shows the language switcher. The instance itself starts in the boot step. */
export function Languages({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <LanguageSwitcher />
    </>
  );
}
