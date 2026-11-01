import { fireEvent, screen, waitFor } from '@testing-library/react';
import { resetPlatform, renderWithPlatform } from '@mfeflow/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { initShellI18n } from './init';
import { LanguageSwitcher } from './LanguageSwitcher';

afterEach(resetPlatform);

describe('LanguageSwitcher', () => {
  it('switches the language and the page direction', async () => {
    await initShellI18n();
    renderWithPlatform(<LanguageSwitcher />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ar' } });
    await waitFor(() => {
      expect(document.documentElement.dir).toBe('rtl');
    });
    expect(screen.getByText('اللغة')).toBeDefined();
  });
});
