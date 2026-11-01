import type { RegistryIndexRemote } from '@mfeflow/contracts';

export const ACTIONS = [
  'read',
  'deploy',
  'promote',
  'rollback',
  'kill',
  'rollout',
  'admin',
] as const;
export type Action = (typeof ACTIONS)[number];

/** A version registered in one env. Files are immutable, so the manifest it was registered with is kept. */
export interface VersionRecord {
  env: string;
  remote: string;
  version: string;
  manifestUrl: string;
  manifestSha256: string;
  manifest: unknown;
  owner: string;
  routes: string[];
  platform?: Record<string, string>;
  budgets?: { initialJsKb?: number };
  createdAt: string;
  createdBy: string | null;
}

/** The current pointer for one remote in one env: what the index serves for it. */
export interface PointerRecord {
  name: string;
  version: string;
  /** The index entry as `buildIndex` made it, with `previous`, `history` and `rolledBackFrom`. */
  remote: RegistryIndexRemote;
  killed: boolean;
  killReason?: string;
  updatedAt: string;
}

/** A candidate being served to `percent`% of clients while the pointer stays on stable. */
export interface RolloutRecord {
  env: string;
  remote: string;
  /** Salts the assignment hash, so a new rollout reshuffles who gets the candidate. */
  id: string;
  stable: string;
  candidate: string;
  /** The index entry served to clients in the candidate group. */
  candidateRemote: RegistryIndexRemote;
  percent: number;
  /** The percents still to come, increasing; `step` moves to the next one. */
  steps: number[];
  startedAt: string;
  updatedAt: string;
}

export interface VersionCounts {
  loads: number;
  errors: number;
}

export interface EnvState {
  env: string;
  /** Bumped on every change; a writer that read an older one is refused. */
  rev: number;
  updatedAt: string;
  /** Oldest first, killed ones included. */
  remotes: PointerRecord[];
}

export interface AuditEntry {
  id: number;
  at: string;
  /** The token's id, never the token. `null` for the local admin command. */
  tokenId: string | null;
  action: string;
  env: string | null;
  remote: string | null;
  before: string | null;
  after: string | null;
  detail: Record<string, unknown>;
}

export type NewAudit = Omit<AuditEntry, 'id'>;

export interface EnvChange {
  env: string;
  /** The `rev` the change was planned against; 0 for an env that does not exist yet. */
  expectedRev: number;
  at: string;
  versions: VersionRecord[];
  pointer: {
    name: string;
    version: string;
    remote: RegistryIndexRemote;
    killed: boolean;
    killReason?: string;
  };
  audit: NewAudit;
  /** Starts or updates this remote's rollout, or ends it. */
  rollout?: { set: RolloutRecord } | { clear: string };
}

export interface TokenRecord {
  id: string;
  /** Hex SHA-256 of the token. The token itself is never stored. */
  hash: string;
  label: string | null;
  env: string;
  remote: string;
  actions: Action[];
  createdAt: string;
  revokedAt: string | null;
}

export interface AuditQuery {
  env?: string;
  remote?: string;
  limit: number;
}

/** Another writer changed the env after this one read it. */
export class RevisionConflictError extends Error {
  constructor(env: string) {
    super(`${env} changed while this request was running; read it again and retry`);
    this.name = 'RevisionConflictError';
  }
}

/** Everything the server keeps. SQLite today; a Postgres implementation only has to satisfy this. */
export interface RegistryStorage {
  readEnv(env: string): Promise<EnvState | undefined>;
  listEnvs(): Promise<string[]>;
  getVersion(env: string, remote: string, version: string): Promise<VersionRecord | undefined>;
  /** Active rollouts in one env. */
  listRollouts(env: string): Promise<RolloutRecord[]>;
  /** Adds browser counts to a rollout's version; ignored when that rollout has ended. */
  addRolloutCounts(rolloutId: string, version: string, counts: VersionCounts): Promise<void>;
  rolloutCounts(rolloutId: string): Promise<Record<string, VersionCounts>>;
  /** Applies the change, its versions and its audit entry in one transaction, or throws `RevisionConflictError`. */
  commit(change: EnvChange): Promise<void>;
  addAudit(entry: NewAudit): Promise<void>;
  /** Newest first. */
  audit(query: AuditQuery): Promise<AuditEntry[]>;
  addToken(token: TokenRecord): Promise<void>;
  getToken(id: string): Promise<TokenRecord | undefined>;
  listTokens(): Promise<TokenRecord[]>;
  revokeToken(id: string, at: string): Promise<boolean>;
  ping(): Promise<void>;
  close(): Promise<void>;
}
