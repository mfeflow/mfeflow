import { defineConfig } from '@rspress/core';

export default defineConfig({
  root: 'docs',
  title: 'mfeflow',
  description:
    'React micro-frontend boilerplate and platform kit for Module Federation 2.0: à-la-carte features, a self-hosted registry and one-command rollback.',
  lang: 'en',
  themeConfig: {
    socialLinks: [{ icon: 'github', mode: 'link', content: 'https://github.com/mfeflow/mfeflow' }],
  },
});
