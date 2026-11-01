---
title: http - typed requests with retries
description: A small fetch client over your url-factory endpoints that retries safe requests, times out slow ones and throws errors you can switch on.
---

# http

Calling an API from a micro-frontend means the same chores in every remote: building the URL, attaching a token, giving up on a hung request and retrying a flaky one. This feature gives each app one client that does those, typed against the endpoints you already defined.

## What you get

Every app gets an `api` client built on `@mfeflow/http`. You call endpoints by the name you gave them in `endpoints.ts`, and the client knows which ones need path params and what each one answers with.

## Add it

`http` needs [url-factory](/features/url-factory), which is on by default. If it is missing, `add` stops with [E206](/errors/E206).

```sh
pnpm mfeflow add http
```

What changed:

- `src/api/client.ts` in the shell and in every remote
- `src/api/client.test.ts` in each of them, if you use [testing](/features/testing)
- `@mfeflow/http` added to each app
- `apiUrl` added to the runtime config, set to `/api`. With [env-t3](/features/env-t3) it is a key in `src/config/schema.ts` and in the dev, staging and prod config files.

## Use it

The generated client has one endpoint, `health`. Tell it what that endpoint answers with, then call it.

```ts title="apps/shell/src/api/client.ts"
import { createHttpClient } from '@mfeflow/http';
import { apiUrl, type endpoints } from './endpoints';

// What each endpoint answers with, by the name in ./endpoints. Add a line per endpoint you call.
interface Responses {
  health: { ok: boolean };
}

export const api = createHttpClient<typeof endpoints, Responses>({
  url: apiUrl,
  // Return the signed-in user's token; no header is sent while this returns undefined.
  // getToken: () => session.accessToken(),
});
```

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

An endpoint with a path parameter will not typecheck without `params`:

```ts
await api.get('getOrder', { params: { orderId: 42 }, query: { expand: 'items' } });
```

## Configure it

The feature has no install options. The client takes these when you create it, and `timeoutMs`, `retry`, `headers` and `credentials` can also be set on a single call.

| Option        | Default        | What it does                                                         |
| ------------- | -------------- | -------------------------------------------------------------------- |
| `url`         | required       | The URL factory from `endpoints.ts`.                                 |
| `getToken`    | none           | Returns the bearer token, sync or async. Asked before every attempt. |
| `headers`     | none           | Sent with every request. A call's own headers win.                   |
| `timeoutMs`   | `10000`        | How long each attempt waits for the response headers.                |
| `retry`       | 2 retries      | `{ retries, baseDelayMs, maxDelayMs }`, or `false` to never retry.   |
| `credentials` | fetch default  | Passed to `fetch`, for cookies on cross-origin calls.                |
| `fetch`       | global `fetch` | Replace it in tests. It is looked up on every request.               |

Per call, `signal` cancels the request and `parse` checks or reshapes the parsed body. Retry delays default to a 200 ms base and a 2 s cap.

## How it works

Only requests that are safe to send twice are retried: GET, HEAD, OPTIONS, PUT and DELETE. POST and PATCH never are. A retry follows a network error, a timeout, or a 408, 425, 429, 502, 503 or 504, after a random wait that doubles each time. If a server sends a `Retry-After` longer than the 2 s cap, you get the error straight away instead of a second 429.

The timeout covers the wait for the response headers. A body that streams slowly afterwards is not cut off, so cancel it with `signal` if you need to. Aborting throws your own reason, not an `HttpError`, and is never retried.

A failed request throws an `HttpError` with a `kind` of `status`, `network`, `timeout`, `parse` or `auth`. It also carries `status`, `body`, `headers` and `attempts`. The `auth` kind means `getToken` threw or rejected, and that is never retried.

The base URL comes from `apiUrl` in the runtime config, read on every call, so one build serves every environment. The client does not add trace headers itself. With [telemetry-otel](/features/telemetry-otel) the SDK instruments the global `fetch`, which this client calls on every request.

## Gotchas

- The error message holds only the method, the endpoint key and what happened, for example `GET getOrder answered 404 Not Found`. There is no URL and no body in it, because both can carry ids and email addresses. Log `error.body` yourself once you have decided it is safe.
- `body` is parsed JSON, or text cut to 4096 characters.
- Start a request inside the span's callback to get it into a trace, as shown in [starting a trace from a click](/features/telemetry-otel#starting-a-trace-from-a-click).
- Add a line to `Responses` for every endpoint you call. An unlisted endpoint answers `unknown`.

## Reference

- [url-factory](/features/url-factory), where endpoints are defined
- [env-t3](/features/env-t3), which validates `apiUrl`
- [Runtime config](/concepts/runtime-config)
- [feature.json reference](/reference/feature-json)
