import { Checker, isObj, type Issue } from './validate';

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
  const authority = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i.exec(template)?.[1];
  if (authority?.includes('{') === true) return 'has a placeholder in the host; put it in the path';
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
    c.string(item, 'version', at);
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
