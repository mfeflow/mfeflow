import { scrubPii } from './pii';

/** Campaign and click ids that analytics tools expect to see; they are kept (unless their value is an email). */
const KEEP = /^(utm_[a-z_]+|gclid|fbclid)$/i;
/** Query keys that carry credentials but are not on `scrubPii`'s exact-name list. */
const SECRET = /token|secret|passw(or)?d|auth|session|api_?key|^key$|^code$/i;

/** A query string with personal data and secrets removed. Returns `''` or a string starting with `?`. */
export function scrubQuery(query: string): string {
  const kept = new URLSearchParams();
  for (const [key, value] of new URLSearchParams(query)) {
    const pii = scrubPii({ [key]: value }).dropped.length > 0;
    if (KEEP.test(key) ? pii : pii || SECRET.test(key)) continue;
    kept.append(key, value);
  }
  const text = kept.toString();
  return text === '' ? '' : `?${text}`;
}

const split = (text: string): [string, string] => {
  const at = text.indexOf('?');
  return at === -1 ? [text, ''] : [text.slice(0, at), text.slice(at)];
};

/**
 * Where the visitor is, as a path for `page_view`: the pathname, the query without personal data,
 * and for hash routers (`/#/catalog?x=1`) the hash route the same way. Never anything else of the hash.
 */
export function currentPath(): string {
  const { pathname, search, hash } = location;
  let path = pathname + scrubQuery(search);
  if (hash.startsWith('#/')) {
    const [route, query] = split(hash.slice(1));
    path += `#${route}${scrubQuery(query)}`;
  }
  return path;
}
