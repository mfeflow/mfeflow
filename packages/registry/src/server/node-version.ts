/** `node:sqlite` stopped needing `--experimental-sqlite` in these releases. */
export const SQLITE_UNFLAGGED = 'Node 22.13 (or 23.4, or any 24+)';

export interface SqliteSupport {
  ok: boolean;
  message: string;
}

/** Whether `node:sqlite` loads without a flag on this Node version (`22.13.0`, with or without a leading `v`). */
export function sqliteSupport(version: string): SqliteSupport {
  const bare = version.replace(/^v/, '');
  const [major = Number.NaN, minor = Number.NaN] = bare
    .split('.')
    .map((part) => Number.parseInt(part, 10));
  const ok = major >= 24 || (major === 23 && minor >= 4) || (major === 22 && minor >= 13);
  return {
    ok,
    message: ok
      ? ''
      : `the registry server needs ${SQLITE_UNFLAGGED}: node:sqlite sits behind --experimental-sqlite before that, and this is Node ${bare}. Upgrade Node.`,
  };
}

export function assertSqliteSupport(version: string = process.versions.node): void {
  const support = sqliteSupport(version);
  if (!support.ok) throw new Error(support.message);
}
