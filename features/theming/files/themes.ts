import { defineTheme } from '@mfeflow/theme';

// Every token becomes a --mf-<token> variable on <html>. Remotes read them with var(--mf-color-fg).
export const themes = [
  defineTheme('light', {
    'color-bg': '#ffffff',
    'color-fg': '#111827',
    'color-surface': '#f3f4f6',
    'color-primary': '#2563eb',
  }),
  defineTheme(
    'dark',
    {
      'color-bg': '#0b1020',
      'color-fg': '#e5e7eb',
      'color-surface': '#1f2937',
      'color-primary': '#60a5fa',
    },
    { colorScheme: 'dark' },
  ),
];

export const defaultTheme = 'light';
