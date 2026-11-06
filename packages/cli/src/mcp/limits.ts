/** Most characters of text one tool call returns. */
export const MAX_TEXT = 40_000;

const FIELD_LIMIT = 4000;
const LIST_LIMIT = 50;

export interface Capped {
  structured: Record<string, unknown>;
  text: string;
  truncated: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function shrink(value: unknown): unknown {
  if (typeof value === 'string' && value.length > FIELD_LIMIT) {
    return `${value.slice(0, FIELD_LIMIT)}\n[${String(value.length - FIELD_LIMIT)} more characters not shown]`;
  }
  if (Array.isArray(value)) {
    const kept = value.slice(0, LIST_LIMIT).map(shrink);
    return value.length > LIST_LIMIT
      ? [...kept, `[${String(value.length - LIST_LIMIT)} more items not shown]`]
      : kept;
  }
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shrink(item)]));
  }
  return value;
}

/** The structured result and its text copy, both kept under `max` characters. */
export function capOutput(result: Record<string, unknown>, max = MAX_TEXT): Capped {
  const full = JSON.stringify(result, null, 2);
  if (full.length <= max) return { structured: result, text: full, truncated: false };
  const note = `Output was cut to fit ${String(max)} characters. Ask for a narrower question, or read the files directly.`;
  const shrunk = shrink(result);
  const structured = { ...(isRecord(shrunk) ? shrunk : {}), truncated: true, note };
  const text = JSON.stringify(structured, null, 2);
  if (text.length <= max) return { structured, text, truncated: true };
  return {
    structured: { truncated: true, note, partial: text.slice(0, 2000) },
    text: `${text.slice(0, max - note.length - 2)}\n${note}`,
    truncated: true,
  };
}
