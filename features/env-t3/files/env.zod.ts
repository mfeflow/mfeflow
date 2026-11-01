import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

// Server and build-time variables, checked when a process that imports this file starts.
// Add one: pnpm mfeflow add env-key API_ORIGIN --scope server --schema "z.url()"
export const env = createEnv({
  server: {
    NODE_ENV: z.enum(['development', 'production', 'test']).optional(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
