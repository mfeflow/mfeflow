import { defineConfig } from '@rspress/core';
import { DOCS_URL } from '@mfeflow/contracts';
import { pluginSitemap } from '@rspress/plugin-sitemap';

/** `/mfeflow/` for a GitHub Pages project site; `/` once the docs have a domain of their own. */
const base = `${new URL(DOCS_URL).pathname.replace(/\/$/, '')}/`;
const description =
  'React micro-frontend boilerplate and platform kit for Module Federation 2.0: à-la-carte features, a self-hosted registry and one-command rollback.';

export default defineConfig({
  root: 'docs',
  base,
  siteOrigin: new URL(DOCS_URL).origin,
  title: 'mfeflow',
  description,
  lang: 'en',
  llms: true,
  plugins: [pluginSitemap({ siteUrl: DOCS_URL })],
  head: [
    ['meta', { property: 'og:site_name', content: 'mfeflow' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:image', content: `${DOCS_URL}/og.png` }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:image', content: `${DOCS_URL}/og.png` }],
    (route) => ['link', { rel: 'canonical', href: `${DOCS_URL}${route.routePath}` }],
    (route) => ['meta', { property: 'og:url', content: `${DOCS_URL}${route.routePath}` }],
  ],
  themeConfig: {
    socialLinks: [{ icon: 'github', mode: 'link', content: 'https://github.com/mfeflow/mfeflow' }],
  },
});
