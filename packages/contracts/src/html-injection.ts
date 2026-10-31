import { pickRegistryFields } from './entry.js';
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

const ESM_TYPES = new Set(['module', 'esm']);

/**
 * The HTML an edge function or server adds to the shell's `index.html` for one
 * route: the registry as `window.__MFE_REGISTRY__` (so the shell fetches no
 * index) and preload hints for the files each remote the route renders needs.
 * Everything the runtime reads from the fetched index is inlined, so both
 * paths register the same remotes; only the per-expose `exposes` file lists
 * stay out of the page.
 *
 * Hints match how the browser will request each file, or it downloads twice:
 * classic scripts and styles are `rel="preload"` without `crossorigin`; the
 * files of a `module`/`esm` remote are `rel="modulepreload"` (CORS anonymous
 * by default, as `import()` fetches them); a remote with no `remoteEntry`
 * (manifest only) gets its manifest as `preload as="fetch" crossorigin`,
 * matching Module Federation's `fetch()`. Nothing here injects a `<script
 * src>` for a remote entry: it needs the shell's runtime first. A remote the
 * registry does not know gets no hints.
 */
export function registryInjection(index: RegistryIndex, needs: readonly RouteNeed[]): string {
  const inline = {
    remotes: index.remotes.map((remote) => pickRegistryFields(remote)),
  };
  let html = `<script>window.__MFE_REGISTRY__=${jsonForScript(inline)}</script>`;
  const seen = new Set<string>();
  const hint = (attrs: string, href: string) => {
    const tag = `<link ${attrs} href="${attribute(href)}">`;
    if (seen.has(tag)) return;
    seen.add(tag);
    html += tag;
  };
  for (const need of needs) {
    const remote = index.remotes.find((r) => r.name === need.remote);
    if (remote === undefined) continue;
    if (remote.remoteEntry === undefined) {
      hint('rel="preload" as="fetch" crossorigin', remote.entry);
      continue;
    }
    const esm = remote.type !== undefined && ESM_TYPES.has(remote.type);
    const script = (href: string) =>
      hint(esm ? 'rel="modulepreload"' : 'rel="preload" as="script"', href);
    script(remote.remoteEntry);
    for (const file of remote.exposes?.[need.expose] ?? [])
      if (/\.css(\?|$)/.test(file)) hint('rel="preload" as="style"', file);
      else script(file);
  }
  return html;
}

/** Index just past the `>` of the tag starting at `from`, or -1 when it never closes. */
function tagEnd(html: string, from: number): number {
  const close = html.indexOf('>', from);
  return close === -1 ? -1 : close + 1;
}

/** `code` equals `lower`, or is its uppercase ASCII letter. */
function sameChar(code: number, lower: number): boolean {
  return code === lower || (lower >= 97 && lower <= 122 && code === lower - 32);
}

/**
 * Index of `needle` (lowercase ASCII) in `html[from, to)`, ignoring ASCII case.
 * Indexes stay on `html` itself: `toLowerCase()` can change a string's length (U+0130),
 * which would shift every offset taken from a lowercased copy.
 */
function indexOfCI(html: string, needle: string, from: number, to = html.length): number {
  const last = to - needle.length;
  for (let at = from; at <= last; at++) {
    let i = 0;
    while (i < needle.length && sameChar(html.charCodeAt(at + i), needle.charCodeAt(i))) i++;
    if (i === needle.length) return at;
  }
  return -1;
}

/** End of the opening `<head>` tag, found with a linear scan (no backtracking). */
function headEnd(html: string): number {
  let at = indexOfCI(html, '<head', 0);
  while (at !== -1) {
    const next = html.charAt(at + 5);
    if (next === '>' || /\s/.test(next)) return tagEnd(html, at);
    at = indexOfCI(html, '<head', at + 5);
  }
  return -1;
}

/** End of the `<meta charset>` (or `http-equiv` content-type) tag inside the head, or -1. */
function charsetEnd(html: string, from: number): number {
  const stop = indexOfCI(html, '</head', from);
  for (let at = indexOfCI(html, '<meta', from); at !== -1;) {
    if (stop !== -1 && at > stop) break;
    const end = tagEnd(html, at);
    if (end === -1) break;
    if (indexOfCI(html, 'charset', at, end) !== -1) return end;
    at = indexOfCI(html, '<meta', end);
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
  const open = headEnd(html);
  if (open === -1) throw new Error('@mfeflow/contracts: the HTML has no <head> to inject into');
  const charset = charsetEnd(html, open);
  const end = charset === -1 ? open : charset;
  return html.slice(0, end) + snippet + html.slice(end);
}
