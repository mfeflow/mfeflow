import {
  parseTrustEnv,
  readTrusted,
  TRUST_ENV,
  trustedNamespaces,
  type Trusted,
} from '@mfeflow/core';
import type { Runtime } from './runtime';

/** What this user trusts among `registries`: the trust file, or MFEFLOW_TRUST_REGISTRIES (public hosts only unless pinned to a template). */
export async function trustedIn(
  rt: Runtime,
  registries: Record<string, string> | undefined,
): Promise<Trusted> {
  return trustedNamespaces(
    registries ?? {},
    await readTrusted(rt.configDir),
    parseTrustEnv(rt.io.env[TRUST_ENV]),
  );
}
