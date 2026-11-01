import crypto from 'node:crypto';
import { ACTIONS, type Action, type RegistryStorage, type TokenRecord } from './storage';

const PREFIX = 'mfr_';
const NAME = /^[a-z][a-z0-9_-]*$/;

export const sha256Hex = (value: string): string =>
  crypto.createHash('sha256').update(value).digest('hex');

export interface NewToken {
  env: string;
  remote: string;
  actions: readonly Action[];
  label?: string;
}

export function parseActions(raw: string): Action[] {
  const known = new Set<string>(ACTIONS);
  const wanted = raw
    .split(',')
    .map((a) => a.trim())
    .filter((a) => a !== '');
  if (wanted.length === 0) throw new Error(`name at least one action: ${ACTIONS.join(', ')}`);
  const bad = wanted.filter((a) => !known.has(a));
  if (bad.length > 0)
    throw new Error(`unknown action ${bad.join(', ')}; use ${ACTIONS.join(', ')}`);
  return [...new Set(wanted)].filter((a): a is Action => known.has(a));
}

/**
 * Makes a token, stores only its hash, and returns the token once. Format `mfr_<id>.<secret>`:
 * the id finds the row, the hash proves the secret.
 */
export async function createToken(
  storage: RegistryStorage,
  input: NewToken,
  now: Date = new Date(),
): Promise<{ id: string; token: string; record: TokenRecord }> {
  if (input.env !== '*' && !NAME.test(input.env))
    throw new Error(`env "${input.env}" must be * or lowercase letters, digits, - and _`);
  if (input.remote !== '*' && !NAME.test(input.remote))
    throw new Error(`remote "${input.remote}" must be * or a remote name`);
  if (input.actions.length === 0) throw new Error('a token needs at least one action');
  const id = crypto.randomBytes(8).toString('hex');
  const secret = crypto.randomBytes(32).toString('base64url');
  const token = `${PREFIX}${id}.${secret}`;
  const record: TokenRecord = {
    id,
    hash: sha256Hex(token),
    label: input.label ?? null,
    env: input.env,
    remote: input.remote,
    actions: [...new Set(input.actions)],
    createdAt: now.toISOString(),
    revokedAt: null,
  };
  await storage.addToken(record);
  return { id, token, record };
}

/** A hash no token has, compared when the id is unknown so a miss costs the same as a wrong secret. */
const DECOY = sha256Hex('mfeflow-registry-decoy');

/** The stored token the bearer value proves, or undefined. Compares hashes in constant time. */
export async function verifyToken(
  storage: RegistryStorage,
  bearer: string,
): Promise<TokenRecord | undefined> {
  const match = /^mfr_([0-9a-f]{16})\.[A-Za-z0-9_-]{20,128}$/.exec(bearer);
  const record = match?.[1] === undefined ? undefined : await storage.getToken(match[1]);
  const stored = Buffer.from(record?.hash ?? DECOY, 'hex');
  const given = Buffer.from(sha256Hex(bearer), 'hex');
  const equal = crypto.timingSafeEqual(stored, given);
  if (!equal || record === undefined || record.revokedAt !== null) return undefined;
  return record;
}

export interface Need {
  action: Action;
  env: string;
  remote?: string;
}

/** Does the token allow this? `admin` allows every action; `*` matches any env or remote. */
export function allows(token: TokenRecord, need: Need): boolean {
  const actionOk = token.actions.includes('admin') || token.actions.includes(need.action);
  const envOk = token.env === '*' || token.env === need.env;
  const remoteOk =
    need.remote === undefined || token.remote === '*' || token.remote === need.remote;
  return actionOk && envOk && remoteOk;
}
