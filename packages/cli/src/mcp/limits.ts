/** Most characters of text one tool call returns. */
export const MAX_TEXT = 40_000;

const FIELD_LIMIT = 4000;
const LIST_LIMIT = 50;

/** Fields the tools page themselves: cutting them here would hide part of a change. */
const UNCUT = new Set(['diff', 'written']);

/** Fields that tell the caller what to do next; no cut may drop them. */
const KEEP = /^(?:id|.*_id|expires_at|diff_pages?|written_count)$/;

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
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, UNCUT.has(key) ? item : shrink(item)]),
    );
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
  const kept = Object.fromEntries(Object.entries(result).filter(([key]) => KEEP.test(key)));
  const head = { ...kept, truncated: true, note };
  let room = Math.max(0, max - JSON.stringify(head, null, 2).length - 40);
  for (;;) {
    const hard = { ...head, partial: text.slice(0, room) };
    const out = JSON.stringify(hard, null, 2);
    if (out.length <= max || room === 0) return { structured: hard, text: out, truncated: true };
    room = Math.floor(room * 0.8);
  }
}
