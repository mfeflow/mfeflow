import type { RegistryIndex } from './registry.js';

/** A remote module the current route renders, e.g. `{ remote: 'cart', expose: './MiniCart' }`. */
export interface RouteNeed {
  remote: string;
  expose: string;
}

const SCRIPT_UNSAFE = new RegExp('[<\\u2028\\u2029]', 'g');

function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(
    SCRIPT_UNSAFE,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

function attribute(value: string): string {
  return value.replace(/[&"<>]/g, (c) => `&#${String(c.charCodeAt(0))};`);
}

/**
 * The HTML an edge function or server adds to the shell's `index.html` for one
 * route: the registry as `window.__MFE_REGISTRY__` (so the shell fetches no
 * index) and `<link rel="preload">` hints for the remote entry and the files of
 * each exposed module the route renders.
 *
 * Hints carry no `crossorigin`, which matches how Module Federation and the
 * remote's chunk loader request scripts; a mismatch downloads the file twice.
 * Nothing here injects a `<script src>` for a remote entry: it needs the
 * shell's runtime first. A remote the registry does not know gets no hints.
 */
export function registryInjection(index: RegistryIndex, needs: readonly RouteNeed[]): string {
  const inline = {
    remotes: index.remotes.map(({ name, entry, remoteEntry }) => ({
      name,
      entry,
      ...(remoteEntry === undefined ? {} : { remoteEntry }),
    })),
  };
  let html = `<script>window.__MFE_REGISTRY__=${jsonForScript(inline)}</script>`;
  const seen = new Set<string>();
  const preload = (href: string, as: 'script' | 'style') => {
    if (seen.has(href)) return;
    seen.add(href);
    html += `<link rel="preload" as="${as}" href="${attribute(href)}">`;
  };
  for (const need of needs) {
    const remote = index.remotes.find((r) => r.name === need.remote);
    if (remote?.remoteEntry === undefined) continue;
    preload(remote.remoteEntry, 'script');
    for (const file of remote.exposes?.[need.expose] ?? [])
      preload(file, /\.css(\?|$)/.test(file) ? 'style' : 'script');
  }
  return html;
}

/** Adds `snippet` right after the opening `<head>` tag. Throws if the page has none. */
export function injectIntoHead(html: string, snippet: string): string {
  const open = /<head(\s[^>]*)?>/i.exec(html);
  if (!open) throw new Error('@mfeflow/contracts: the HTML has no <head> to inject into');
  const end = open.index + open[0].length;
  return html.slice(0, end) + snippet + html.slice(end);
}
