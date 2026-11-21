import { createHash } from 'node:crypto';

const WORKSPACE_BASENAME = 'pnpm-workspace.yaml';
const PNPM_KEY = 'minimumReleaseAgeExclude:';

/** Line endings differ between checkouts (autocrlf); the hash must not. */
export function normalizeEol(content: string): string {
  return content.replace(/\r\n/g, '\n');
}

const isBlank = (line: string) => line.trim() === '';

/** `text` without a trailing YAML comment (` # ...`), found by a plain scan. */
function withoutComment(text: string): string {
  for (let i = 1; i < text.length; i += 1) {
    if (text[i] === '#' && (text[i - 1] === ' ' || text[i - 1] === '\t'))
      return text.slice(0, i).trimEnd();
  }
  return text;
}

/** The lines of `content`, each keeping its own `\n` (the last one may have none). */
function linesOf(content: string): string[] {
  const lines: string[] = [];
  let from = 0;
  while (from < content.length) {
    const at = content.indexOf('\n', from);
    const to = at === -1 ? content.length : at + 1;
    lines.push(content.slice(from, to));
    from = to;
  }
  return lines;
}
const bracketDepth = (text: string) =>
  (text.match(/[[{]/g)?.length ?? 0) - (text.match(/[\]}]/g)?.length ?? 0);

/** How many lines from `start` belong to the value of the key on `lines[start]`. */
function valueLength(lines: string[], start: number): number {
  const rest = withoutComment((lines[start] ?? '').slice(PNPM_KEY.length).trimEnd());
  let end = start + 1;
  if (rest.trim().startsWith('[') || rest.trim().startsWith('{')) {
    let depth = bracketDepth(rest);
    while (depth > 0 && end < lines.length) depth += bracketDepth(lines[end++] ?? '');
    return end - start;
  }
  if (rest.trim() !== '') return 1;
  while (end < lines.length) {
    const line = lines[end] ?? '';
    if (!isBlank(line) && !/^\s/.test(line) && !/^-(\s|$)/.test(line)) break;
    end += 1;
  }
  return end - start;
}

/**
 * `content` without the top-level `minimumReleaseAgeExclude` key, which pnpm appends to
 * pnpm-workspace.yaml when it approves freshly published packages. Everything else is untouched,
 * so a file without the key keeps its hash.
 */
export function withoutPnpmWrittenKeys(content: string): string {
  if (!content.includes(PNPM_KEY)) return content;
  const lines = linesOf(content);
  const kept: string[] = [];
  for (let i = 0; i < lines.length;) {
    if (!lines[i]?.startsWith(PNPM_KEY)) {
      kept.push(lines[i++] ?? '');
      continue;
    }
    let end = i + valueLength(lines, i);
    while (end > i + 1 && isBlank(lines[end - 1] ?? '') && end < lines.length) end -= 1;
    i = end;
    if (lines.slice(i).every(isBlank)) {
      while (kept.length > 0 && isBlank(kept.at(-1) ?? '')) kept.pop();
      i = lines.length;
    }
  }
  return kept.join('');
}

/** `sha256-<hex>` of the content with LF line endings. */
export function hashContent(content: string): string {
  return `sha256-${createHash('sha256').update(normalizeEol(content)).digest('hex')}`;
}

const isWorkspaceFile = (file: string) => file.split(/[\\/]/).at(-1) === WORKSPACE_BASENAME;

/**
 * The hash mfeflow records for a file and compares against to see if someone edited it. Like
 * `hashContent`, except pnpm-workspace.yaml (at any depth) leaves out the keys pnpm writes by itself.
 * Not for the stale-write guard in `applyPlan`, which must see every byte that changed.
 */
export function hashTracked(file: string, content: string): string {
  return hashContent(
    isWorkspaceFile(file) ? withoutPnpmWrittenKeys(normalizeEol(content)) : content,
  );
}
