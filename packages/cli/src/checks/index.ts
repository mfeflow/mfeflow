import type { Check } from '../findings';
import { compat } from './compat';
import { appsOnDisk, drift, localCheckout, mfeJson, ports, registry, routes } from './config';
import { envChecks } from './env';
import { runtimePlugins } from './plugins';
import { singletonVersions } from './singletons';
import { workspaceVersions } from './workspace';

/** What `mfeflow validate` runs: the files against their schemas and each other. */
export const VALIDATE_CHECKS: readonly Check[] = [appsOnDisk, mfeJson, routes, registry];

export const COMPAT_CHECKS: readonly Check[] = [compat];

/** Every check `mfeflow doctor` runs, in order. */
export const DOCTOR_CHECKS: readonly Check[] = [
  appsOnDisk,
  mfeJson,
  ports,
  routes,
  registry,
  localCheckout,
  singletonVersions,
  workspaceVersions,
  compat,
  drift,
  runtimePlugins,
  envChecks,
];
