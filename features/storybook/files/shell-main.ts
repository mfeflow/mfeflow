import fs from 'node:fs';
import path from 'node:path';
import type { StorybookConfig } from 'storybook-react-rsbuild';

// The shell's Storybook shows its own stories and every remote's, each remote as a ref. Remotes are read from
// mfeflow.json, so one added later appears here without an edit. A ref is the remote's Storybook as built by
// `pnpm storybook:build` (apps/<remote>/dist/storybook), served from /<remote>/ inside this one.
const root = path.resolve(import.meta.dirname, '../../..');

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined;
}

function remoteStorybooks(): { name: string; built: string }[] {
  const apps = field(JSON.parse(fs.readFileSync(path.join(root, 'mfeflow.json'), 'utf8')), 'apps');
  if (typeof apps !== 'object' || apps === null) return [];
  return Object.entries(apps).flatMap(([name, app]) => {
    const dir = field(app, 'path');
    if (field(app, 'kind') !== 'remote' || typeof dir !== 'string') return [];
    const built = path.join(root, dir, 'dist/storybook');
    return fs.existsSync(path.join(built, 'index.json')) ? [{ name, built }] : [];
  });
}

const remotes = remoteStorybooks();

const config: StorybookConfig = {
  framework: {
    name: 'storybook-react-rsbuild',
    options: { builder: { rsbuildConfigPath: './.storybook/rsbuild.config.ts' } },
  },
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: [],
  core: { disableTelemetry: true, disableWhatsNewNotifications: true },
  staticDirs: remotes.map(({ name, built }) => ({ from: built, to: `/${name}` })),
  refs: Object.fromEntries(remotes.map(({ name }) => [name, { title: name, url: `./${name}` }])),
};

export default config;
