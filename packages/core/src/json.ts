import { MfeflowError, messageOf } from './errors.js';

/** A plain object as a record, or an empty one for anything else. */
export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {};
}

/** The indentation a JSON file already uses: a tab, spaces, or two spaces when it cannot tell. */
export function indentOf(source: string): string | number {
  const match = /^[ \t]+(?=")/m.exec(source);
  return match ? match[0] : 2;
}

/** Parses a JSON file that must hold an object; anything else is an E208 naming the file. */
export function parseJsonObject(file: string, source: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new MfeflowError('E208', `${file} is not valid JSON (${messageOf(error)})`, {
      cause: error,
    });
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new MfeflowError('E208', `${file} is not a JSON object`);
  }
  return asRecord(parsed);
}

/**
 * Edits a JSON object file, keeping its indentation and final newline. When
 * `edit` returns false nothing changed and the source comes back untouched,
 * byte for byte.
 */
export function editJsonObject(
  file: string,
  source: string,
  edit: (value: Record<string, unknown>) => boolean,
): string {
  const value = parseJsonObject(file, source);
  if (!edit(value)) return source;
  return `${JSON.stringify(value, null, indentOf(source))}${source.endsWith('\n') ? '\n' : ''}`;
}
