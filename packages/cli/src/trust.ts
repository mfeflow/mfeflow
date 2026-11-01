import { namespacesFromEnv, readTrusted, TRUST_ENV, trustedNamespaces } from '@mfeflow/core';
import type { Runtime } from './runtime';

/** The namespaces in `registries` this user trusts: recorded with the same URL, or named in MFEFLOW_TRUST_REGISTRIES. */
export async function trustedIn(
  rt: Runtime,
  registries: Record<string, string> | undefined,
): Promise<Set<string>> {
  return trustedNamespaces(
    registries ?? {},
    await readTrusted(rt.configDir),
    namespacesFromEnv(rt.io.env[TRUST_ENV]),
  );
}
