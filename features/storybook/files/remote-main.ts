import type { StorybookConfig } from 'storybook-react-rsbuild';

const config: StorybookConfig = {
  framework: {
    name: 'storybook-react-rsbuild',
    options: { builder: { rsbuildConfigPath: './.storybook/rsbuild.config.ts' } },
  },
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: [],
  core: { disableTelemetry: true, disableWhatsNewNotifications: true },
};

export default config;
