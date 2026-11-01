import { Checker, isObj, type Issue } from './validate';

const INDEX_VERSION =
  /^\d{1,9}\.\d{1,9}\.\d{1,9}(?:-[0-9A-Za-z.-]{1,64})?(?:\+[0-9A-Za-z.-]{1,64})?$/;

/** One feature a third-party registry offers. `name` has no namespace: the registry's own namespace goes in front. */
export interface FeatureRegistryItem {
  name: string;
  version: string;
  description: string;
  keywords?: string[];
}

/** `<base>/index.json` of a third-party feature registry. */
export interface FeatureRegistryIndex {
  $schema?: string;
  items: FeatureRegistryItem[];
}

export const REGISTRY_ITEM_NAME = /^[a-z][a-z0-9-]*$/;
export const MAX_INDEX_ITEMS = 1000;
export const MAX_DESCRIPTION = 300;
export const MAX_KEYWORDS = 20;
export const MAX_KEYWORD = 40;

/** Control and format characters, so a registry cannot write escape sequences to a terminal. */
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Cn}\p{Co}\p{Cs}]/u;

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** Plain http is allowed for the machine you are on, so a registry can be tried before it is hosted. */
export function isLoopbackHttp(url: URL): boolean {
  return url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);
}

/** True when `url` is https, or http on a loopback host. */
export function isRegistryProtocol(url: URL): boolean {
  return url.protocol === 'https:' || isLoopbackHttp(url);
}

const PLACEHOLDER = /\{([^{}]*)\}/g;

/** Why `template` cannot be a registry URL, or undefined when it can. */
export function registryTemplateProblem(template: string): string | undefined {
  if (!template.includes('{name}')) return 'must contain {name}';
  const unknown = [...template.matchAll(PLACEHOLDER)]
    .map((m) => m[1] ?? '')
    .find((name) => name !== 'name' && name !== 'version');
  if (unknown !== undefined) return `has {${unknown}}; only {name} and {version} are placeholders`;
  if (/[{}]/.test(template.replaceAll(PLACEHOLDER, ''))) return 'has an unmatched { or }';
  const origin = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i.exec(template);
  if (origin?.[1]?.includes('{') === true)
    return 'has a placeholder in the host; put it in the path';
  const first = template.search(/\{(?:name|version)\}/);
  if (origin !== null && template.lastIndexOf('/', first) < origin[0].length) {
    return 'needs a path before the first placeholder, like https://host/{name}.json';
  }
  let url: URL;
  try {
    url = new URL(template.replaceAll('{name}', 'x').replaceAll('{version}', '1'));
  } catch {
    return 'is not a URL';
  }
  if (!isRegistryProtocol(url)) {
    return url.protocol === 'http:'
      ? 'must be https (http is allowed only for 127.0.0.1, localhost and [::1])'
      : 'must be an https URL';
  }
  if (url.username !== '' || url.password !== '') return 'must not contain a user name or password';
  return undefined;
}

/**
 * Where a registry's `index.json` is: in the folder the template starts in, before the first
 * segment that has a placeholder. `https://x.dev/r/{name}.json` has its index at `https://x.dev/r/index.json`.
 */
export function registryIndexUrl(template: string): string {
  const at = template.search(/\{(?:name|version)\}/);
  const base = template.slice(0, template.lastIndexOf('/', at) + 1);
  return new URL('index.json', base).href;
}

export function validateFeatureRegistryIndex(value: unknown): Issue[] {
  const c = new Checker();
  if (!isObj(value)) {
    c.add('', 'must be an object');
    return c.issues;
  }
  const items = value.items;
  if (!Array.isArray(items)) {
    c.add('items', 'is required and must be an array');
    return c.issues;
  }
  if (items.length > MAX_INDEX_ITEMS) {
    c.add('items', `has more than ${String(MAX_INDEX_ITEMS)} items`);
    return c.issues;
  }
  const seen = new Set<string>();
  items.forEach((item: unknown, i) => {
    const at = `items[${String(i)}]`;
    if (!isObj(item)) {
      c.add(at, 'must be an object');
      return;
    }
    const name = c.string(item, 'name', at, {
      pattern: REGISTRY_ITEM_NAME,
      hint: 'must be a feature name without the namespace, like "analytics-segment"',
    });
    if (name !== undefined) {
      if (seen.has(name)) c.add(`${at}.name`, `"${name}" is listed twice`);
      seen.add(name);
    }
    c.string(item, 'version', at, {
      pattern: INDEX_VERSION,
      hint: 'must be a version like 1.2.0',
    });
    const description = c.string(item, 'description', at);
    if (description !== undefined) {
      if (description.length > MAX_DESCRIPTION) {
        c.add(`${at}.description`, `must be at most ${String(MAX_DESCRIPTION)} characters`);
      } else if (INVISIBLE.test(description)) {
        c.add(`${at}.description`, 'must be plain text without control characters');
      }
    }
    const keywords = c.stringArray(item, 'keywords', at, { required: false });
    if (keywords.length > MAX_KEYWORDS) {
      c.add(`${at}.keywords`, `must have at most ${String(MAX_KEYWORDS)} entries`);
    }
    keywords.forEach((keyword, k) => {
      if (keyword.length > MAX_KEYWORD || INVISIBLE.test(keyword)) {
        c.add(
          `${at}.keywords[${String(k)}]`,
          `must be plain text of at most ${String(MAX_KEYWORD)} characters`,
        );
      }
    });
  });
  return c.issues;
}

export function isFeatureRegistryIndex(value: unknown): value is FeatureRegistryIndex {
  return validateFeatureRegistryIndex(value).length === 0;
}

function ipv4Octets(host: string): number[] | undefined {
  const parts = host.split('.');
  if (parts.length !== 4) return undefined;
  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : Number.NaN));
  return octets.every((n) => n <= 255) ? octets : undefined;
}

function isPrivateIpv4([a = 0, b = 0]: number[]): boolean {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

const side = (part: string) => (part === '' ? [] : part.split(':'));

function ipv6Groups(host: string): number[] | undefined {
  const [head = '', tail, ...rest] = host.split('::');
  if (rest.length > 0) return undefined;
  const headGroups = side(head);
  const groups = [...headGroups, ...(tail === undefined ? [] : side(tail))];
  if (groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return undefined;
  const numbers = groups.map((g) => Number.parseInt(g, 16));
  if (tail === undefined) return numbers.length === 8 ? numbers : undefined;
  const missing = 8 - numbers.length;
  if (missing < 1) return undefined;
  return [
    ...numbers.slice(0, headGroups.length),
    ...Array.from({ length: missing }, () => 0),
    ...numbers.slice(headGroups.length),
  ];
}

function isPrivateIpv6(host: string): boolean {
  const groups = ipv6Groups(host);
  if (groups === undefined) return false;
  const [g0 = 0] = groups;
  if (groups.slice(0, 7).every((g) => g === 0) && (groups[7] === 0 || groups[7] === 1)) return true;
  if ((g0 & 0xfe00) === 0xfc00 || (g0 & 0xffc0) === 0xfe80) return true;
  const mapped = groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff;
  const [hi = 0, lo = 0] = groups.slice(6);
  return mapped && isPrivateIpv4([hi >> 8, hi & 0xff, lo >> 8, lo & 0xff]);
}

/**
 * True when `hostname` (as `URL.hostname` spells it) is the machine itself or a private network:
 * localhost, 127/8, ::1, 10/8, 172.16/12, 192.168/16, 169.254/16, fc00::/7, fe80::/10 and 0/8.
 * Only the literal host is looked at; a public name that resolves to a private address is not caught.
 */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host.includes(':')) return isPrivateIpv6(host);
  const octets = ipv4Octets(host);
  return octets !== undefined && isPrivateIpv4(octets);
}

const SECRET_PARAM = /token|key|sig|auth|passw|secret|credential|x-amz-/i;
const URL_PARTS = /^([a-z][a-z0-9+.-]*:\/\/)([^/?#@]*@)?([^?#]*)(\?[^#]*)?(#.*)?$/i;

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * `url` with the values of token-like query parameters (token, key, sig, auth, password, secret,
 * X-Amz-*) and any user name or password replaced by `***`. Works on templates too, so `{name}` stays.
 */
export function redactUrl(url: string): string {
  const parts = URL_PARTS.exec(url);
  if (parts === null) return url;
  const [, scheme = '', userinfo, rest = '', query, hash = ''] = parts;
  const redacted = query
    ?.slice(1)
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=');
      if (eq === -1) return pair;
      const key = pair.slice(0, eq);
      return SECRET_PARAM.test(safeDecode(key)) ? `${key}=***` : pair;
    })
    .join('&');
  const search = redacted === undefined ? '' : `?${redacted}`;
  return `${scheme}${userinfo === undefined ? '' : '***@'}${rest}${search}${hash}`;
}

/** `text` with every http(s) URL in it passed through `redactUrl`, for messages that quote one. */
export function redactUrlsIn(text: string): string {
  return text.replaceAll(/https?:\/\/[^\s"'<>]+/gi, (found) => redactUrl(found));
}
