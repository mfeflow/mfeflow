# http

A fetch client over your url-factory endpoints. Off by default; needs `url-factory`.

```sh
mfeflow add http
```

## What you get

| File                           | What it is for                                                                                              |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `apps/<app>/src/api/client.ts` | `api`: an `@mfeflow/http` client over `./endpoints`. Add the response type of each endpoint to `Responses`. |
| the runtime config             | `apiUrl`, the base URL of the `api` service. Default `/api`.                                                |

With `testing`, each client gets a test that goes through the mock server. `endpoints.ts` (from `url-factory`) now reads
`<service>Url` from the runtime config on every call, so `apiUrl` sets the base of the `api` service and a build runs in
every environment.

## Using it

```ts
import { isHttpError } from '@mfeflow/http';
import { api } from './api/client';

const { ok } = await api.get('health');

try {
  await api.post('addOrder', { json: { sku: 'A1' } });
} catch (error) {
  if (isHttpError(error) && error.status === 409) showConflict(error.body);
  else throw error;
}
```

Endpoints with params take `params`, and the call fails typecheck without them:
`api.get('getOrder', { params: { orderId: 42 }, query: { expand: 'items' } })`.

## Authentication

```ts
export const api = createHttpClient<typeof endpoints, Responses>({
  url: apiUrl,
  getToken: () => session.accessToken(),
});
```

`getToken` may be async. It is asked before every attempt, so a refreshed token is used on a retry. While it returns
`undefined` (signed out) no header is sent.

## Retries and timeouts

- GET, HEAD, OPTIONS, PUT and DELETE are retried; POST and PATCH never are.
- A retry happens after a network error, a timeout, or a 408, 425, 429, 502, 503 or 504: twice by default, after a
  random wait that doubles (200 ms, 400 ms, ... up to 2 s). A `Retry-After` longer than 2 s is not waited for; you get
  the error.
- Each attempt times out after 10 seconds. Change it with `timeoutMs`, per client or per call. `retry: false` turns
  retries off.
- Pass `signal` to cancel. Aborting throws your reason, is not an `HttpError` and is not retried.

## Errors

`HttpError` has `kind` (`status`, `network`, `timeout`, `parse`), `status`, `body` (parsed JSON, or text cut to 4096
characters), `headers` and `attempts`. Its message is only the method, the endpoint key and what happened, for example
`GET getOrder answered 404 Not Found`: no URL and no body, because they carry ids and email addresses. Log
`error.body` yourself if you have decided it is safe to.

## Traces

The client does not add `traceparent`. With `telemetry-otel`, the SDK instruments `fetch`, and this client calls the
global `fetch` on every request, so the header is added however late the SDK started. Start the request inside the
span's callback, as in the [telemetry page](./telemetry-otel.md#starting-a-trace-from-a-click).
