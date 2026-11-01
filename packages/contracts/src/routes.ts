function segments(route: string): string[] {
  return route.toLowerCase().split('/').filter(Boolean);
}

const isParam = (segment: string): boolean => segment.startsWith(':');
const isWild = (segment: string): boolean => segment.endsWith('*');
const prefixOf = (segment: string): string => (isParam(segment) ? '' : segment.slice(0, -1));

const tailAt = (list: string[], i: number): boolean =>
  i === list.length - 1 && isWild(list[i] ?? '');

/** Whether two segments can match the same text. */
function segmentsMeet(x: string, y: string): boolean {
  if (isWild(x) && isWild(y)) return x.startsWith(prefixOf(y)) || y.startsWith(prefixOf(x));
  if (isWild(x)) return isParam(y) || y.startsWith(prefixOf(x));
  if (isWild(y)) return isParam(x) || x.startsWith(prefixOf(y));
  return x === y || isParam(x) || isParam(y);
}

/**
 * True when some URL path matches both routes. Routes compare case-insensitively and ignore a
 * trailing slash. A `*` on the last segment (`/checkout/*`, `/checkout*`, `/:rest*`) matches any
 * tail, including none; anywhere else it stays inside one segment. `:param` matches one segment.
 */
export function routesOverlap(a: string, b: string): boolean {
  const left = segments(a);
  const right = segments(b);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const x = left[i];
    const y = right[i];
    if (x === undefined) return tailAt(right, i) && prefixOf(y ?? '') === '';
    if (y === undefined) return tailAt(left, i) && prefixOf(x) === '';
    if (!segmentsMeet(x, y)) return false;
    if (tailAt(left, i) || tailAt(right, i)) return true;
  }
  return true;
}
