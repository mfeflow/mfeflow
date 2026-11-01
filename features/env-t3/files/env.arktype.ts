import { createEnv } from '@t3-oss/env-core';
import { type } from 'arktype';

// Server and build-time variables, checked when a process that imports this file starts.
// Add one: pnpm mfeflow add env-key API_ORIGIN --scope server --schema "type('string.url')"
export const env = createEnv({
  server: {
    NODE_ENV: type("'development' | 'production' | 'test' | undefined"),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
