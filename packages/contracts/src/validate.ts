export interface Issue {
  /** Where, e.g. `routes[0]` or `rollout.percent`. Empty for the root. */
  path: string;
  message: string;
}

export type Obj = Record<string, unknown>;

export function isObj(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class Checker {
  readonly issues: Issue[] = [];

  add(path: string, message: string): void {
    this.issues.push({ path, message });
  }

  /** Reports a missing or wrong-typed string and returns it when valid. */
  string(
    obj: Obj,
    key: string,
    path: string,
    opts: { required?: boolean; pattern?: RegExp; hint?: string } = {},
  ): string | undefined {
    const value = obj[key];
    const at = path ? `${path}.${key}` : key;
    if (value === undefined) {
      if (opts.required ?? true) this.add(at, 'is required');
      return undefined;
    }
    if (typeof value !== 'string') {
      this.add(at, 'must be a string');
      return undefined;
    }
    if (opts.pattern && !opts.pattern.test(value)) {
      this.add(at, opts.hint ?? `must match ${String(opts.pattern)}`);
      return undefined;
    }
    return value;
  }

  stringArray(
    obj: Obj,
    key: string,
    path: string,
    opts: { required?: boolean; pattern?: RegExp; hint?: string } = {},
  ): string[] {
    const value = obj[key];
    const at = path ? `${path}.${key}` : key;
    if (value === undefined) {
      if (opts.required ?? true) this.add(at, 'is required');
      return [];
    }
    if (!Array.isArray(value)) {
      this.add(at, 'must be an array of strings');
      return [];
    }
    const out: string[] = [];
    value.forEach((item: unknown, i) => {
      if (typeof item !== 'string') this.add(`${at}[${String(i)}]`, 'must be a string');
      else if (opts.pattern && !opts.pattern.test(item))
        this.add(`${at}[${String(i)}]`, opts.hint ?? `must match ${String(opts.pattern)}`);
      else out.push(item);
    });
    return out;
  }

  number(
    obj: Obj,
    key: string,
    path: string,
    opts: { required?: boolean; min?: number; max?: number } = {},
  ): number | undefined {
    const value = obj[key];
    const at = path ? `${path}.${key}` : key;
    if (value === undefined) {
      if (opts.required ?? true) this.add(at, 'is required');
      return undefined;
    }
    if (typeof value !== 'number' || Number.isNaN(value)) {
      this.add(at, 'must be a number');
      return undefined;
    }
    if (opts.min !== undefined && value < opts.min) this.add(at, `must be ≥ ${String(opts.min)}`);
    if (opts.max !== undefined && value > opts.max) this.add(at, `must be ≤ ${String(opts.max)}`);
    return value;
  }

  object(obj: Obj, key: string, path: string, required = true): Obj | undefined {
    const value = obj[key];
    const at = path ? `${path}.${key}` : key;
    if (value === undefined) {
      if (required) this.add(at, 'is required');
      return undefined;
    }
    if (!isObj(value)) {
      this.add(at, 'must be an object');
      return undefined;
    }
    return value;
  }
}

export function isUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * A path inside a project: relative, forward slashes, no `.` or `..` segments,
 * no drive letters. Features and `mfeflow.json` only ever name files this way.
 */
const SEGMENT = String.raw`(?!\.\.?(?:/|$))[^/\\\u0000]+`;

/** The regex form of `isSafeRelativePath`, for JSON Schema. */
export const SAFE_RELATIVE_PATH = new RegExp(`^(?![A-Za-z]:)${SEGMENT}(?:/${SEGMENT})*$`);

export function isSafeRelativePath(value: string): boolean {
  if (value === '' || value.includes('\\') || value.includes('\0')) return false;
  if (value.startsWith('/') || /^[A-Za-z]:/.test(value)) return false;
  return value.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}
