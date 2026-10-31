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
    remotes: index.remotes.map(({ name, entry, remoteEntry, type, entryGlobalName }) => ({
      name,
      entry,
      ...(remoteEntry === undefined ? {} : { remoteEntry }),
      ...(type === undefined ? {} : { type }),
      ...(entryGlobalName === undefined ? {} : { entryGlobalName }),
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

/** Index just past the `>` of the tag starting at `from`, or -1 when it never closes. */
function tagEnd(html: string, from: number): number {
  const close = html.indexOf('>', from);
  return close === -1 ? -1 : close + 1;
}

/** End of the opening `<head>` tag, found with a linear scan (no backtracking). */
function headEnd(lower: string): number {
  let at = lower.indexOf('<head');
  while (at !== -1) {
    const next = lower.charAt(at + 5);
    if (next === '>' || /\s/.test(next)) return tagEnd(lower, at);
    at = lower.indexOf('<head', at + 5);
  }
  return -1;
}

/** End of the `<meta charset>` (or `http-equiv` content-type) tag inside the head, or -1. */
function charsetEnd(lower: string, from: number): number {
  const stop = lower.indexOf('</head', from);
  for (let at = lower.indexOf('<meta', from); at !== -1;) {
    if (stop !== -1 && at > stop) break;
    const end = tagEnd(lower, at);
    if (end === -1) break;
    if (lower.slice(at, end).includes('charset')) return end;
    at = lower.indexOf('<meta', end);
  }
  return -1;
}

/**
 * Adds `snippet` to the page's `<head>`: right after the `<meta charset>` when
 * there is one (the browser only looks for the charset in the first 1024
 * bytes, so nothing may push it back), else right after the opening tag.
 * Throws if the page has no head.
 */
export function injectIntoHead(html: string, snippet: string): string {
  const lower = html.toLowerCase();
  const open = headEnd(lower);
  if (open === -1) throw new Error('@mfeflow/contracts: the HTML has no <head> to inject into');
  const charset = charsetEnd(lower, open);
  const end = charset === -1 ? open : charset;
  return html.slice(0, end) + snippet + html.slice(end);
}
