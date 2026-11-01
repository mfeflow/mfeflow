import { MfeflowError } from '../errors';

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

/** Four letters from an FNV-1a hash of the whole name. */
function shortHash(text: string): string {
  let hash = 0x811c9dc5;
  for (const char of text) {
    hash = Math.imul(hash ^ char.codePointAt(0)!, 0x01000193) >>> 0;
  }
  let out = '';
  for (let i = 0; i < 4; i++) {
    out += LETTERS[hash % 26];
    hash = Math.floor(hash / 26);
  }
  return out;
}

/**
 * The Tailwind class prefix of an app. Tailwind 4 accepts lowercase letters only, so a name made of
 * letters is its own prefix (`cart:flex`); any other name keeps its letters and gets four more from a hash
 * of the whole name, so `cart_b` and `cartb` (and `cart1` and `cart2`) never share one.
 */
export function tailwindPrefix(name: string): string {
  if (/^[a-z]+$/.test(name)) return name;
  const letters = name.replace(/[^a-z]/g, '') || 'app';
  return letters + shortHash(name);
}

/** Throws if two apps map to the same prefix, which would bring back the collision the prefix prevents. */
export function assertUniqueTailwindPrefixes(
  names: readonly string[],
  prefixOf: (name: string) => string = tailwindPrefix,
): void {
  const seen = new Map<string, string>();
  for (const name of names) {
    const prefix = prefixOf(name);
    const other = seen.get(prefix);
    if (other !== undefined) {
      throw new MfeflowError(
        'E208',
        `the apps "${other}" and "${name}" would both use the Tailwind prefix "${prefix}"; rename one of them`,
      );
    }
    seen.set(prefix, name);
  }
}
