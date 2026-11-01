// What the react-scale features promise, checked on a generated project:
//  - two remotes using the same Tailwind utility with different tokens do not collide, only the shell has the reset,
//    the theme and the language reach every remote and survive a reload (specs/ui.spec.txt, a browser test);
//  - Clarity is requested only after analytics consent (specs/clarity.spec.txt, a browser test);
//  - the shell's Storybook lists every remote and renders their stories (specs/storybook.spec.txt, a browser test,
//    and the output files for combinations that run no browser).
import fs from 'node:fs';
import path from 'node:path';
import { REMOTE_NAMES, runsUiE2e, type Combo } from './combos.ts';

const specs = path.join(import.meta.dirname, 'specs');
const TOKEN = '--color-primary: var(--mf-color-primary, #2563eb);';

/** Catalog and cart get their own primary colour; the other remotes keep the one that reads the theme. */
const TOKENS: Record<string, string> = { catalog: '#b91c1c', cart: '#0f766e' };

function copySpec(project: string, from: string, to: string): void {
  fs.mkdirSync(path.join(project, 'e2e'), { recursive: true });
  fs.copyFileSync(path.join(specs, from), path.join(project, 'e2e', to));
}

/** Writes the browser specs, and the token changes the UI spec expects, before `pnpm test:e2e`. */
export function prepareE2e(project: string, combo: Combo): string | undefined {
  if (runsUiE2e(combo)) {
    for (const [name, colour] of Object.entries(TOKENS)) {
      const file = path.join(project, 'apps', name, 'src/styles.css');
      const css = fs.readFileSync(file, 'utf8');
      if (!css.includes(TOKEN)) return `${file} has no line "${TOKEN}" to change`;
      fs.writeFileSync(file, css.replace(TOKEN, `--color-primary: ${colour};`));
    }
    copySpec(project, 'ui.spec.txt', 'ui.spec.ts');
  }
  if (combo.storybook) copySpec(project, 'storybook.spec.txt', 'storybook.spec.ts');
  if (combo.clarity) {
    const config = path.join(
      project,
      'apps/shell/public/config',
      combo.env ? 'runtime-config.dev.json' : 'runtime-config.json',
    );
    const text = fs.readFileSync(config, 'utf8');
    if (!text.includes('"clarityId": ""')) return `${config} has no empty clarityId to fill`;
    fs.writeFileSync(config, text.replace('"clarityId": ""', '"clarityId": "k3x9m2abcd"'));
    copySpec(project, 'clarity.spec.txt', 'clarity.spec.ts');
  }
  return undefined;
}

/** The composed Storybook exists, with a ref for every remote. */
export function storybookChecks(project: string, combo: Combo): string | undefined {
  const shell = path.join(project, 'apps/shell/storybook-static');
  if (!fs.existsSync(path.join(shell, 'index.html')))
    return `no ${shell}/index.html after storybook:build`;
  for (const name of REMOTE_NAMES.slice(0, combo.remotes)) {
    if (!fs.existsSync(path.join(shell, name, 'index.json')))
      return `the shell Storybook has no copy of ${name}'s stories (${path.join(shell, name, 'index.json')})`;
  }
  return undefined;
}

/** After `pnpm build` ran on top of the Storybook builds: both outputs are still there, and nothing of Storybook is in dist. */
export function storybookSurvivesBuild(project: string, combo: Combo): string | undefined {
  const problem = storybookChecks(project, combo);
  if (problem) return `after pnpm build: ${problem}`;
  for (const app of ['shell', ...REMOTE_NAMES.slice(0, combo.remotes)]) {
    const dist = path.join(project, 'apps', app, 'dist');
    const files = fs.existsSync(dist)
      ? fs.readdirSync(dist, { recursive: true, encoding: 'utf8' })
      : [];
    const found = files.find((file) => /storybook|iframe\.html|sb-manager/.test(file));
    if (found)
      return `apps/${app}/dist holds Storybook output (${found}), which would ship to the CDN`;
    if (!fs.existsSync(path.join(project, 'apps', app, 'storybook-static', 'index.json')))
      return `apps/${app}/storybook-static is gone after pnpm build`;
  }
  return undefined;
}
