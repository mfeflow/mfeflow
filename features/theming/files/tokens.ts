import { cssVar } from '@mfeflow/theme';

// The shell sets these on <html>. The second argument is what a standalone run (no shell) falls back to.
export const tokens = {
  bg: cssVar('color-bg', '#ffffff'),
  fg: cssVar('color-fg', '#111827'),
  surface: cssVar('color-surface', '#f3f4f6'),
  primary: cssVar('color-primary', '#2563eb'),
};
