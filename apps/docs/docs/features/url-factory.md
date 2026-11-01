---
title: url-factory - typed API endpoints and URL building
description: Define your API endpoints once and build their URLs with checked parameters, with base URLs read from runtime config instead of a build.
---

# url-factory

This page shows how to stop assembling API URLs from strings. You list your endpoints once, and every URL you build from them has its path parameters and base URL checked.

## What you get

Every app gets an `endpoints.ts` with a typed endpoint table and a URL builder. The base URL for each API service comes from runtime config, so one build runs in every environment. This feature is on by default in new projects.

## Add it

```sh
pnpm mfeflow add url-factory
```

What changed:

- `apps/shell/src/api/endpoints.ts`
- `apps/<remote>/src/api/endpoints.ts` in every remote
- `@mfeflow/url-factory` added to the shell and every remote

## Use it

The generated file declares one endpoint and exports the builder:

```ts title="apps/cart/src/api/endpoints.ts"
export const endpoints = defineEndpoints({
  health: { service: 'api', path: '/health' },
});

export const apiUrl = createUrlFactory(endpoints, (service) => {
  const base = configured(service) ?? defaults[service];
  return base === undefined ? undefined : new URL(base, location.origin).toString();
});
```

Add your own endpoints, using `:name` for path parameters, then build URLs from the key:

```ts
const endpoints = defineEndpoints({
  health: { service: 'api', path: '/health' },
  getOrder: { service: 'orders', path: '/v1/orders/:orderId' },
});

apiUrl('getOrder', { params: { orderId: 42 }, query: { expand: 'items' } });
// https://orders.example.com/v1/orders/42?expand=items

apiUrl('getOrder'); // compile error: orderId is missing
apiUrl('getOrdr'); // compile error: no such endpoint
```

## Configure it

There are no install options. These are the settings in `endpoints.ts`:

| Setting                       | Default           | What it does                                           |
| ----------------------------- | ----------------- | ------------------------------------------------------ |
| `service` on each endpoint    | `api`             | Which base URL the endpoint uses                       |
| `<service>Url` runtime config | none              | The base URL for a service, such as `apiUrl` for `api` |
| `defaults`                    | `{ api: '/api' }` | Fallback base used in tests and standalone runs        |

A service whose base URL is neither in runtime config nor in `defaults` throws when you build a URL. Add the config key per environment as described in [env-t3](/features/env-t3).

## How it works

`defineEndpoints` keeps the literal paths, so TypeScript can read the `:name` segments and require exactly those parameters. The builder looks up the endpoint, asks your function for the service's base URL on every call, fills the path with encoded values and appends the query.

Because the base is read on every call, config that loads after the app starts works. Array query values repeat the key, and `null` or `undefined` values are skipped.

## Gotchas

- Paths must start with `/`, or `defineEndpoints` throws.
- A parameter value of `.` or `..` is rejected, because it would walk out of the path. Other values are URL-encoded.
- Using runtime config means the base URL is wrong until the shell has loaded it. Build URLs when you make a request, not at module load.

## Reference

- [http](/features/http), whose client is built on these endpoints
- [env-t3](/features/env-t3), which owns runtime config
- [Runtime config](/concepts/runtime-config)
- [route-factory](/features/route-factory), the same idea for links between remotes
