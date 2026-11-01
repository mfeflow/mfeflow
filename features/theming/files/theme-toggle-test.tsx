import { fireEvent, screen } from '@testing-library/react';
import { renderWithPlatform } from '@mfeflow/testing';
import { describe, expect, it } from 'vitest';
import { Theme } from './Theme';

describe('Theme', () => {
  it('switches the theme on <html> and remembers it', () => {
    renderWithPlatform(
      <Theme>
        <p>content</p>
      </Theme>,
    );
    expect(document.documentElement.dataset.theme).toBe('light');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'dark' } });
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('shell:theme')).toBe('"dark"');
  });
});
