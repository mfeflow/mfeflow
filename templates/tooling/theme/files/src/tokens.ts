import type { ThemeTokens } from '@mfeflow/theme';

// Every token becomes --mf-<name> on <html>. Keep the two lists on the same names.
export const lightTokens: ThemeTokens = Object.freeze({
  'color-bg': '#ffffff',
  'color-fg': '#1b1b1f',
  'color-muted': '#5c5f66',
  'color-primary': '#3451b2',
  'color-primary-fg': '#ffffff',
  'radius-md': '8px',
  'space-md': '16px',
});

export const darkTokens: ThemeTokens = Object.freeze({
  'color-bg': '#121316',
  'color-fg': '#f2f2f4',
  'color-muted': '#a3a6ad',
  'color-primary': '#7d96f0',
  'color-primary-fg': '#0f1220',
  'radius-md': '8px',
  'space-md': '16px',
});
