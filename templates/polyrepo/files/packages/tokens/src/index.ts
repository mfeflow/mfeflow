export const colors = {
  text: '#1b1b1f',
  surface: '#ffffff',
  accent: '#3451b2',
} as const;

export const space = {
  small: 8,
  medium: 16,
  large: 24,
} as const;

export type Space = keyof typeof space;
