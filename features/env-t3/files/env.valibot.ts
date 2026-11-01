import { createEnv } from '@t3-oss/env-core';
import * as v from 'valibot';

// Server and build-time variables, checked when a process that imports this file starts.
// Add one: pnpm mfeflow add env-key API_ORIGIN --scope server --schema "v.pipe(v.string(), v.url())"
export const env = createEnv({
  server: {
    NODE_ENV: v.optional(v.picklist(['development', 'production', 'test'])),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
