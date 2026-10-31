import { createHash } from 'node:crypto';

/** Line endings differ between checkouts (autocrlf); the hash must not. */
export function normalizeEol(content: string): string {
  return content.replace(/\r\n/g, '\n');
}

/** `sha256-<hex>` of the content with LF line endings. */
export function hashContent(content: string): string {
  return `sha256-${createHash('sha256').update(normalizeEol(content)).digest('hex')}`;
}
