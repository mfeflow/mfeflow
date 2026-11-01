/** Applied in order, once each, inside a transaction. Never edit one that has shipped; add the next. */
export const MIGRATIONS: readonly { id: number; name: string; sql: string }[] = [
  {
    id: 1,
    name: 'initial',
    sql: `
      CREATE TABLE envs (
        env TEXT PRIMARY KEY,
        rev INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE versions (
        env TEXT NOT NULL,
        remote TEXT NOT NULL,
        version TEXT NOT NULL,
        manifest_url TEXT NOT NULL,
        manifest_sha256 TEXT NOT NULL,
        manifest_json TEXT NOT NULL,
        owner TEXT NOT NULL,
        routes_json TEXT NOT NULL,
        platform_json TEXT,
        budgets_json TEXT,
        created_at TEXT NOT NULL,
        created_by TEXT,
        PRIMARY KEY (env, remote, version)
      );
      CREATE TABLE pointers (
        env TEXT NOT NULL,
        remote TEXT NOT NULL,
        version TEXT NOT NULL,
        remote_json TEXT NOT NULL,
        killed INTEGER NOT NULL DEFAULT 0,
        kill_reason TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (env, remote)
      );
      CREATE TABLE audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at TEXT NOT NULL,
        token_id TEXT,
        action TEXT NOT NULL,
        env TEXT,
        remote TEXT,
        before_version TEXT,
        after_version TEXT,
        detail_json TEXT NOT NULL
      );
      CREATE INDEX audit_env ON audit (env, id);
      CREATE TABLE tokens (
        id TEXT PRIMARY KEY,
        hash TEXT NOT NULL UNIQUE,
        label TEXT,
        env TEXT NOT NULL,
        remote TEXT NOT NULL,
        actions_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        revoked_at TEXT
      );
    `,
  },
];
