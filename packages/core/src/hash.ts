import { createHash } from 'node:crypto';

/** Line endings differ between checkouts (autocrlf); the hash must not. */
export function normalizeEol(content: string): string {
  return content.replace(/\r\n/g, '\n');
}

/**
 * pnpm appends `minimumReleaseAgeExclude` to pnpm-workspace.yaml on an install that approves freshly
 * published packages. It is pnpm's key, not an edit, so the hash leaves it out.
 */
function withoutPnpmWrittenKeys(content: string): string {
  if (!content.includes('minimumReleaseAgeExclude:')) return content;
  const kept: string[] = [];
  let inKey = false;
  for (const line of content.split('\n')) {
    if (line.startsWith('minimumReleaseAgeExclude:')) {
      inKey = true;
      continue;
    }
    if (inKey && /^\s+\S/.test(line)) continue;
    inKey = false;
    kept.push(line);
  }
  return kept.join('\n');
}

/** `sha256-<hex>` of the content with LF line endings, without keys pnpm writes by itself. */
export function hashContent(content: string): string {
  const text = withoutPnpmWrittenKeys(normalizeEol(content));
  return `sha256-${createHash('sha256').update(text).digest('hex')}`;
}
