---
title: Runtime config
description: Why browser settings come from a JSON file fetched at boot instead of the bundle, how the shell loads and types it, and how dev and production serve the right file.
---

# Runtime config

This page explains how one build can run in dev, staging and production with different settings. The settings live in a JSON file that the shell fetches when it starts. They are not compiled into the JavaScript.

## Why not use environment variables in the bundle?

A value baked into a bundle is fixed at build time. To change an API address you rebuild. To run the same build in staging and production you need two builds, and what you tested is not what you shipped.

Runtime config lets you build once. Each environment supplies its own small file next to the same files.

## What does it look like?

The default project has one file per environment. Each holds an `environment` key. Features add more keys when you install them.

```json title="apps/shell/public/config/runtime-config.dev.json"
{
  "environment": "dev"
}
```

A schema describes the shape. The browser imports only its type, so the validator code stays out of the bundle:

```ts title="apps/shell/src/config/schema.ts"
import { z } from 'zod';

export const runtimeConfigSchema = z.object({
  environment: z.enum(['dev', 'staging', 'prod']),
});
```

## Which keys does the shell read itself?

Two optional keys tell the shell where to find the registry index. Without them it uses `/registry/index.json` on its own origin.

| Key               | Meaning                                                                    |
| ----------------- | -------------------------------------------------------------------------- |
| `registryUrls`    | List of index URLs, primary first. A failed primary falls back to the next |
| `registryOrigins` | Origins other than the page's that those URLs may be on                    |

```json title="runtime-config.prod.json"
{
  "environment": "prod",
  "registryUrls": ["https://cdn.example.com/registry/index.json", "/registry/index.json"],
  "registryOrigins": ["https://cdn.example.com"]
}
```

The shell waits at most 1.5 seconds for the config before it falls back to the default, so a slow config never blocks boot. See [The registry index](/concepts/registry-index).

## Who adds keys?

You do, with one command, and some features do it for you. The command writes the schema entry and a placeholder into every environment file:

```bash
pnpm mfeflow add env-key GTM_ID --scope runtime --schema "z.string().min(1)"
```

The analytics-gtm feature adds a container id key this way. The http feature adds `apiUrl`. See [env-t3](/features/env-t3).

## How does the shell load it?

At boot the shell calls `fetchRuntimeConfig`. It requests `/config/runtime-config.json` once, stores the result on `globalThis.__MFE_RUNTIME_CONFIG__`, and gives every caller the same promise. Analytics, telemetry and your own code share that one request.

If the file cannot be loaded, the promise rejects and the shell reports the failure. Features that need a key decide what to do without it. Code that reads the config before it loaded throws a clear error.

## Which file does each environment get?

The request is always for `/config/runtime-config.json`. What answers it differs.

| Where                                | Who answers                                                                                                                                    |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `mfeflow dev` and the preview server | The dev server returns `runtime-config.<env>.json`, where `<env>` is the `MFE_ENV` variable, default `dev`. It reads the file on each request. |
| A deployed site                      | Your deploy copies the file for that environment to `/config/runtime-config.json`                                                              |

A missing file for the chosen environment is a 404 that lists the environments it found.

## How do I check the files?

Run the check before a deploy:

```bash
pnpm check:runtime-config
```

It validates every `runtime-config*.json` against the schema. `mfeflow doctor` also warns when a file is missing keys the schema requires (E119).

## What should not go in it?

The file is public. Anyone can fetch it. Put in addresses and identifiers, such as an API URL or an analytics id. Never put in secrets. Server secrets belong in `env.ts`, which stays out of the browser bundle.

## Related

- Where the files live: [Project structure](/guide/project-structure).
- Serving it in production: [Deploy](/guide/deploying).
