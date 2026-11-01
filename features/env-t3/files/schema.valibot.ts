import * as v from 'valibot';

// The shape of public/config/runtime-config.<env>.json. The browser only imports this file's type
// (see ./runtime), so the validator stays out of the bundle; `pnpm check:runtime-config` validates the files.
// Add a key: pnpm mfeflow add env-key GTM_ID --scope runtime --schema "v.pipe(v.string(), v.minLength(1))"
export const runtimeConfigSchema = v.object({
  environment: v.picklist(['dev', 'staging', 'prod']),
});
