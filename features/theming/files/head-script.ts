import { registerHeadScript } from '@mfeflow/rsbuild';
import { noFlashScript } from '@mfeflow/theme';
import { defaultTheme, followSystem, themes } from './themes';

// Imported by rsbuild.config.ts. The script goes first in the shell's <head>, so the stored theme is on <html>
// before any bundle has loaded. It needs the CSP to allow an inline script (a nonce or 'unsafe-inline');
// without that, apply-stored.ts still sets the theme before the first render.
registerHeadScript('theme', noFlashScript(themes, { defaultTheme, followSystem }));
