import fs from 'node:fs';
import path from 'node:path';
import type { LlmsTxtContext } from '@rspress/core';
import { DOCS_URL } from '@mfeflow/contracts';
import cli from '../../packages/cli/package.json';

const DOCS_DIR = path.join(import.meta.dirname, 'docs');

export const LLMS_SUMMARY = `mfeflow is a command line tool and a set of small packages for React micro-frontends on Module Federation 2. The latest version is ${cli.version}. It is MIT licensed and builds with Rsbuild by default, or with Vite when you pass --bundler vite. It creates a shell and remotes, adds features one at a time, and checks the project with doctor, validate and budget. It is not for a single-team app, for Next.js, or for server-side rendering.`;

function words(segment: string) {
  const text = segment.replaceAll('-', ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function pageExists(routes: string[]) {
  const base = path.join(DOCS_DIR, ...routes);
  return ['.md', '.mdx', '/index.md', '/index.mdx'].some((ext) => fs.existsSync(`${base}${ext}`));
}

function frontmatterTitle(file: string) {
  try {
    const head = /^---\n([\s\S]*?)\n---/.exec(fs.readFileSync(file, 'utf8'))?.[1] ?? '';
    const raw = /^title:\s*(.+)$/m.exec(head)?.[1]?.trim();
    return raw?.replace(/^(['"])(.*)\1$/, '$2');
  } catch {
    return undefined;
  }
}

/** BreadcrumbList JSON-LD for a doc page, or undefined for the home and 404 pages. */
export function breadcrumbList(routePath: string, absolutePath: string, siteUrl = DOCS_URL) {
  const segments = routePath.split('/').filter(Boolean);
  if (segments.length === 0 || segments[0] === '404') return undefined;

  const items = [{ name: 'mfeflow', url: `${siteUrl}/` }];
  for (let i = 1; i < segments.length; i += 1) {
    const parents = segments.slice(0, i);
    if (pageExists(parents))
      items.push({ name: words(parents[i - 1] ?? ''), url: `${siteUrl}/${parents.join('/')}/` });
  }
  items.push({
    name: frontmatterTitle(absolutePath) ?? words(segments.at(-1) ?? ''),
    url: `${siteUrl}${routePath}`,
  });

  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

export function breadcrumbScript(routePath: string, absolutePath: string) {
  const list = breadcrumbList(routePath, absolutePath);
  if (!list) return undefined;
  const json = JSON.stringify(list).replaceAll('<', String.raw`<`);
  return `<script type="application/ld+json">${json}</script>`;
}

const ERRORS_PREFIX = '/errors/';

/** llms.txt with a short summary first and the error pages in their own section at the end. */
export function renderLlmsTxt({ title, sections }: LlmsTxtContext) {
  const errors = sections.flatMap((section) =>
    section.pages.filter((page) => page.routePath.startsWith(ERRORS_PREFIX)),
  );
  const rest = sections
    .map((section) => ({
      ...section,
      pages: section.pages.filter((page) => !page.routePath.startsWith(ERRORS_PREFIX)),
    }))
    .filter((section) => section.pages.length > 0);
  if (errors.length > 0) rest.push({ title: 'Error codes', pages: errors });

  const lines = [`# ${title ?? 'mfeflow'}`, '', `> ${LLMS_SUMMARY}`];
  for (const section of rest) {
    lines.push('', `## ${section.title}`, '');
    for (const page of section.pages) {
      lines.push(
        `- [${page.title}](${page.link})${page.description ? `: ${page.description}` : ''}`,
      );
    }
  }
  return `${lines.join('\n')}\n`;
}
