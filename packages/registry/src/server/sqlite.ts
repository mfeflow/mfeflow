import fs from 'node:fs/promises';
import { isRegistryIndexRemote } from '@mfeflow/contracts';
import { MIGRATIONS } from './migrations';
import { assertSqliteSupport } from './node-version';
import {
  ACTIONS,
  RevisionConflictError,
  type Action,
  type AuditEntry,
  type AuditQuery,
  type EnvChange,
  type EnvState,
  type NewAudit,
  type PointerRecord,
  type RolloutRecord,
  type VersionCounts,
  type RegistryStorage,
  type TokenRecord,
  type VersionRecord,
} from './storage';

type Row = Record<string, unknown>;

function text(row: Row, column: string): string {
  const value = row[column];
  if (typeof value !== 'string') throw new TypeError(`column ${column} is not text`);
  return value;
}

const maybeText = (row: Row, column: string): string | null => {
  const value = row[column];
  return typeof value === 'string' ? value : null;
};

function whole(row: Row, column: string): number {
  const value = row[column];
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  throw new TypeError(`column ${column} is not a number`);
}

function json(row: Row, column: string): unknown {
  return JSON.parse(text(row, column));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) if (typeof entry === 'string') out[key] = entry;
  return out;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function versionOf(row: Row): VersionRecord {
  const platform =
    row.platform_json === null ? undefined : stringRecord(json(row, 'platform_json'));
  const budgets = row.budgets_json === null ? undefined : json(row, 'budgets_json');
  const kb =
    isRecord(budgets) && typeof budgets.initialJsKb === 'number' ? budgets.initialJsKb : undefined;
  return {
    env: text(row, 'env'),
    remote: text(row, 'remote'),
    version: text(row, 'version'),
    manifestUrl: text(row, 'manifest_url'),
    manifestSha256: text(row, 'manifest_sha256'),
    manifest: json(row, 'manifest_json'),
    owner: text(row, 'owner'),
    routes: stringList(json(row, 'routes_json')),
    ...(platform === undefined ? {} : { platform }),
    ...(kb === undefined ? {} : { budgets: { initialJsKb: kb } }),
    createdAt: text(row, 'created_at'),
    createdBy: maybeText(row, 'created_by'),
  };
}

function pointerOf(row: Row): PointerRecord {
  const remote = json(row, 'remote_json');
  if (!isRegistryIndexRemote(remote))
    throw new TypeError(`stored remote ${text(row, 'remote')} is not valid`);
  const reason = maybeText(row, 'kill_reason');
  return {
    name: text(row, 'remote'),
    version: text(row, 'version'),
    remote,
    killed: whole(row, 'killed') === 1,
    ...(reason === null ? {} : { killReason: reason }),
    updatedAt: text(row, 'updated_at'),
  };
}

function rolloutOf(row: Row): RolloutRecord {
  const candidateRemote = json(row, 'candidate_json');
  if (!isRegistryIndexRemote(candidateRemote))
    throw new TypeError(`stored rollout ${text(row, 'remote')} is not valid`);
  const steps = json(row, 'steps_json');
  return {
    env: text(row, 'env'),
    remote: text(row, 'remote'),
    id: text(row, 'rollout_id'),
    stable: text(row, 'stable_version'),
    candidate: text(row, 'candidate_version'),
    candidateRemote,
    percent: whole(row, 'percent'),
    steps: Array.isArray(steps) ? steps.filter((s): s is number => typeof s === 'number') : [],
    startedAt: text(row, 'started_at'),
    updatedAt: text(row, 'updated_at'),
  };
}

function auditOf(row: Row): AuditEntry {
  const detail = json(row, 'detail_json');
  return {
    id: whole(row, 'id'),
    at: text(row, 'at'),
    tokenId: maybeText(row, 'token_id'),
    action: text(row, 'action'),
    env: maybeText(row, 'env'),
    remote: maybeText(row, 'remote'),
    before: maybeText(row, 'before_version'),
    after: maybeText(row, 'after_version'),
    detail: isRecord(detail) ? detail : {},
  };
}

function tokenOf(row: Row): TokenRecord {
  const known = new Set<string>(ACTIONS);
  const actions = stringList(json(row, 'actions_json')).filter((a): a is Action => known.has(a));
  return {
    id: text(row, 'id'),
    hash: text(row, 'hash'),
    label: maybeText(row, 'label'),
    env: text(row, 'env'),
    remote: text(row, 'remote'),
    actions,
    createdAt: text(row, 'created_at'),
    revokedAt: maybeText(row, 'revoked_at'),
  };
}

const isBusy = (error: unknown): boolean =>
  error instanceof Error && /database is locked|SQLITE_BUSY/i.test(error.message);

/** A new database file is private to the owner; an existing one keeps its mode. */
function ignoreExists(error: unknown): void {
  if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
}

export interface SqliteOptions {
  /** For tests of the version check; defaults to this process's Node. */
  nodeVersion?: string;
  /** How long a writer waits for another process's lock before giving up with a conflict. */
  busyTimeoutMs?: number;
}

/** node:sqlite is synchronous; a failed query still has to reject rather than throw. */
const sync =
  <A extends unknown[], R>(fn: (...args: A) => R) =>
  (...args: A): Promise<R> => {
    try {
      return Promise.resolve(fn(...args));
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  };

/**
 * Opens (and migrates) the SQLite file. `node:sqlite` is loaded here, after the version check, so an
 * older Node gets a clear message instead of a module-not-found error.
 */
export async function openSqliteStorage(
  file: string,
  options: SqliteOptions = {},
): Promise<RegistryStorage> {
  assertSqliteSupport(options.nodeVersion);
  const { DatabaseSync } = await import('node:sqlite');
  if (file !== ':memory:')
    await fs.writeFile(file, '', { flag: 'wx', mode: 0o600 }).catch(ignoreExists);
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA busy_timeout = ${String(options.busyTimeoutMs ?? 5000)}`);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)',
  );

  const all = (sql: string, ...params: (string | number | null)[]): Row[] =>
    db.prepare(sql).all(...params);
  const one = (sql: string, ...params: (string | number | null)[]): Row | undefined =>
    db.prepare(sql).get(...params);
  const run = (sql: string, ...params: (string | number | null)[]): void => {
    db.prepare(sql).run(...params);
  };

  const applied = new Set(all('SELECT id FROM schema_migrations').map((r) => whole(r, 'id')));
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(migration.sql);
      run(
        'INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)',
        migration.id,
        migration.name,
        new Date().toISOString(),
      );
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  const insertAudit = (entry: NewAudit): void => {
    run(
      'INSERT INTO audit (at, token_id, action, env, remote, before_version, after_version, detail_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      entry.at,
      entry.tokenId,
      entry.action,
      entry.env,
      entry.remote,
      entry.before,
      entry.after,
      JSON.stringify(entry.detail),
    );
  };

  const writeChange = (change: EnvChange): void => {
    const current = one('SELECT rev FROM envs WHERE env = ?', change.env);
    const rev = current === undefined ? 0 : whole(current, 'rev');
    if (rev !== change.expectedRev) throw new RevisionConflictError(change.env);
    if (current === undefined)
      run('INSERT INTO envs (env, rev, updated_at) VALUES (?, 1, ?)', change.env, change.at);
    else run('UPDATE envs SET rev = rev + 1, updated_at = ? WHERE env = ?', change.at, change.env);
    for (const v of change.versions) {
      run(
        'INSERT OR IGNORE INTO versions (env, remote, version, manifest_url, manifest_sha256, manifest_json, owner, routes_json, platform_json, budgets_json, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        v.env,
        v.remote,
        v.version,
        v.manifestUrl,
        v.manifestSha256,
        JSON.stringify(v.manifest),
        v.owner,
        JSON.stringify(v.routes),
        v.platform === undefined ? null : JSON.stringify(v.platform),
        v.budgets === undefined ? null : JSON.stringify(v.budgets),
        v.createdAt,
        v.createdBy,
      );
    }
    const p = change.pointer;
    run(
      `INSERT INTO pointers (env, remote, version, remote_json, killed, kill_reason, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (env, remote) DO UPDATE SET version = excluded.version, remote_json = excluded.remote_json,
         killed = excluded.killed, kill_reason = excluded.kill_reason, updated_at = excluded.updated_at`,
      change.env,
      p.name,
      p.version,
      JSON.stringify(p.remote),
      p.killed ? 1 : 0,
      p.killReason ?? null,
      change.at,
    );
    if (change.rollout !== undefined) {
      if ('clear' in change.rollout) {
        run('DELETE FROM rollouts WHERE env = ? AND remote = ?', change.env, change.pointer.name);
        run('DELETE FROM rollout_reporters WHERE rollout_id = ?', change.rollout.clear);
      } else {
        const r = change.rollout.set;
        run(
          `INSERT INTO rollouts (env, remote, rollout_id, stable_version, candidate_version, candidate_json, percent, steps_json, started_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (env, remote) DO UPDATE SET rollout_id = excluded.rollout_id, stable_version = excluded.stable_version,
             candidate_version = excluded.candidate_version, candidate_json = excluded.candidate_json, percent = excluded.percent,
             steps_json = excluded.steps_json, updated_at = excluded.updated_at`,
          r.env,
          r.remote,
          r.id,
          r.stable,
          r.candidate,
          JSON.stringify(r.candidateRemote),
          r.percent,
          JSON.stringify(r.steps),
          r.startedAt,
          r.updatedAt,
        );
      }
    }
    insertAudit(change.audit);
  };

  let closed = false;
  return {
    readEnv: sync((env): EnvState | undefined => {
      const head = one('SELECT rev, updated_at FROM envs WHERE env = ?', env);
      if (head === undefined) return undefined;
      const remotes = all('SELECT * FROM pointers WHERE env = ? ORDER BY rowid', env).map(
        pointerOf,
      );
      return { env, rev: whole(head, 'rev'), updatedAt: text(head, 'updated_at'), remotes };
    }),
    listEnvs: sync(() => all('SELECT env FROM envs ORDER BY env').map((r) => text(r, 'env'))),
    getVersion: sync((env, remote, version) => {
      const row = one(
        'SELECT * FROM versions WHERE env = ? AND remote = ? AND version = ?',
        env,
        remote,
        version,
      );
      return row === undefined ? undefined : versionOf(row);
    }),
    listRollouts: sync((env) =>
      all('SELECT * FROM rollouts WHERE env = ? ORDER BY remote', env).map(rolloutOf),
    ),
    addRolloutReport: sync((rolloutId, version, client, errored) => {
      run(
        `INSERT INTO rollout_reporters (rollout_id, version, client, errored)
         SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM rollouts WHERE rollout_id = ?)
         ON CONFLICT (rollout_id, version, client) DO UPDATE SET errored = MAX(errored, excluded.errored)`,
        rolloutId,
        version,
        client,
        errored ? 1 : 0,
        rolloutId,
      );
    }),
    rolloutCounts: sync((rolloutId) => {
      const out: Record<string, VersionCounts> = {};
      for (const row of all(
        'SELECT version, COUNT(*) AS clients, SUM(errored) AS errors FROM rollout_reporters WHERE rollout_id = ? GROUP BY version',
        rolloutId,
      )) {
        const clients = whole(row, 'clients');
        out[text(row, 'version')] = { loads: clients, errors: whole(row, 'errors'), clients };
      }
      return out;
    }),
    commit: sync((change) => {
      try {
        db.exec('BEGIN IMMEDIATE');
      } catch (error) {
        throw isBusy(error) ? new RevisionConflictError(change.env) : error;
      }
      try {
        writeChange(change);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    }),
    addAudit: sync((entry) => {
      insertAudit(entry);
    }),
    audit: sync((query: AuditQuery) => {
      const where = [
        ...(query.env === undefined ? [] : ['env = ?']),
        ...(query.remote === undefined ? [] : ['remote = ?']),
      ];
      const params = [
        ...(query.env === undefined ? [] : [query.env]),
        ...(query.remote === undefined ? [] : [query.remote]),
      ];
      const sql = `SELECT * FROM audit ${where.length === 0 ? '' : `WHERE ${where.join(' AND ')}`} ORDER BY id DESC LIMIT ?`;
      return all(sql, ...params, query.limit).map(auditOf);
    }),
    addToken: sync((token) => {
      run(
        'INSERT INTO tokens (id, hash, label, env, remote, actions_json, created_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)',
        token.id,
        token.hash,
        token.label,
        token.env,
        token.remote,
        JSON.stringify(token.actions),
        token.createdAt,
      );
    }),
    getToken: sync((id) => {
      const row = one('SELECT * FROM tokens WHERE id = ?', id);
      return row === undefined ? undefined : tokenOf(row);
    }),
    listTokens: sync(() => all('SELECT * FROM tokens ORDER BY created_at, id').map(tokenOf)),
    revokeToken: sync((id, at) => {
      const row = one('SELECT revoked_at FROM tokens WHERE id = ?', id);
      if (row === undefined || row.revoked_at !== null) return false;
      run('UPDATE tokens SET revoked_at = ? WHERE id = ?', at, id);
      return true;
    }),
    ping: sync(() => {
      one('SELECT 1');
    }),
    close: sync(() => {
      if (closed) return;
      closed = true;
      db.close();
    }),
  };
}
