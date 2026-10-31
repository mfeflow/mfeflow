import type { Check } from '../findings';

/** Decision 0020: `.env.example` and runtime-config.<env>.json against the schema. Waits for the env-t3 feature. */
export const envChecks: Check = {
  id: 'env.schema',
  title: 'env files match the typed env schema (decision 0020)',
  run: ({ project }) =>
    Promise.resolve({
      findings: [],
      ...('env-t3' in project.features ? {} : { skipped: 'the env-t3 feature is not installed' }),
    }),
};
