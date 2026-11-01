# @mfeflow/http

A small fetch client over [`@mfeflow/url-factory`](../url-factory) endpoints. Base URLs come from the runtime config, so one build runs in every environment. It adds an async bearer token, a timeout, retries with backoff for idempotent methods, typed JSON and an error that carries the status and body but no URL.

## Install

```sh
pnpm add @mfeflow/http @mfeflow/url-factory
```

In a project made with mfeflow, `mfeflow add http` writes `src/api/client.ts` in every app.

## Usage

```ts
import { createUrlFactory, defineEndpoints } from '@mfeflow/url-factory';
import { createHttpClient, isHttpError } from '@mfeflow/http';

const endpoints = defineEndpoints({
  listProducts: { service: 'api', path: '/products' },
  getProduct: { service: 'api', path: '/products/:sku' },
  addOrder: { service: 'api', path: '/orders' },
});
const apiUrl = createUrlFactory(endpoints, (service) => config.services[service]);

const api = createHttpClient<typeof endpoints, { listProducts: Product[]; getProduct: Product }>({
  url: apiUrl,
  getToken: () => session.accessToken(), // may be async; return undefined when signed out
});

const mugs = await api.get('listProducts', { query: { q: 'mug' } }); // Product[]
await api.post('addOrder', { json: { sku: 'A1' } });

try {
  await api.get('getProduct', { params: { sku: 'nope' } });
} catch (error) {
  if (isHttpError(error) && error.status === 404) showNotFound(error.body);
}
```

A second type argument says what each endpoint answers with; `parse` on a call checks the body and sets the type instead.

## What it does

- **Retries** GET, HEAD, OPTIONS, PUT and DELETE (never POST or PATCH) on a network error, a timeout and 408, 425, 429, 502, 503 and 504: twice by default, with exponential backoff and jitter. A `Retry-After` longer than the longest wait is not waited for. `retry: false` turns it off.
- **Times out** each attempt after 10 seconds of waiting for the headers (`timeoutMs`); a slow body is not cut off. Your own `AbortSignal` is passed through; aborting it throws your reason and is not retried.
- **Errors** are `HttpError` with `kind` (`status`, `network`, `timeout`, `parse`, `auth`), `status`, `body` (parsed JSON, or text cut to 4096 characters), `headers` and `attempts`. The message holds the method, the endpoint key and what happened: no URL and no body, so ids and emails stay out of logs by default.
- **Does not add `traceparent`.** `@mfeflow/telemetry` instruments `fetch` for that, and this client calls the global `fetch` at request time, so the instrumentation applies however late it was installed.

## Module Federation sharing

Bucket: **stateless**. Nothing here holds state shared between micro-frontends, so each remote can bundle its own copy and different versions can run side by side. No sharing config is needed.

## Links

- [mfeflow repository](https://github.com/mfeflow/mfeflow) and its README
- [Documentation](https://mfeflow.github.io/mfeflow/)

MIT licensed.
