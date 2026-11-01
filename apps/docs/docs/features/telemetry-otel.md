---
title: telemetry-otel - Browser traces tagged by remote
description: Send OpenTelemetry traces, fetch timing, web vitals and remote load failures to your collector, with every span tagged by the remote that made it.
---

# telemetry-otel

This feature shows you what your micro-frontends are doing in real browsers. Spans, fetch requests, Core Web Vitals and remote load failures go to an OTLP endpoint, and each one says which remote it came from. The OpenTelemetry SDK loads after the page has painted, so it stays off the path to first render.

## What you get

A shell that starts telemetry from its runtime config, and a tracer per remote that tags every span with `mfe.name`. Failed remote loads and render errors are reported without any wiring in your remotes. It is off by default, and with no endpoint set the SDK is never downloaded.

## Add it

```sh
pnpm mfeflow add telemetry-otel
```

What changed:

- `apps/shell/src/telemetry/init.ts`, the boot step that reads the runtime config and loads the SDK when it is idle
- `apps/<remote>/src/telemetry.ts` in every remote, exporting `tracer`
- `@mfeflow/telemetry` added to the shell and every remote
- `otlpEndpoint`, `traceSampleRatio` and `propagateTraceHeaderCorsUrls` in the runtime config
- unit tests next to each file, if you have the `testing` feature

## Use it

### Turn it on

Point the shell at an OTLP/HTTP traces URL in the environment that should send data:

```json title="apps/shell/public/config/runtime-config.prod.json"
{
  "environment": "prod",
  "otlpEndpoint": "https://collector.example.com/v1/traces",
  "traceSampleRatio": 0.1,
  "propagateTraceHeaderCorsUrls": ["https://api.example.com"]
}
```

### Start a trace from a click

The generated file in each remote exports a tracer, named after the remote:

```ts title="apps/cart/src/telemetry.ts"
import { getTracer } from '@mfeflow/telemetry';

export const tracer = getTracer('cart');
```

Use it where something worth timing happens:

```ts
import { tracer } from '../telemetry';

function onClick() {
  tracer.startActiveSpan('checkout.click', (span) => {
    void fetch('/api/orders').finally(() => span.end());
  });
}
```

Start the `fetch` inside the callback, before any `await`. The reason is in "How it works" below.

### Know when a remote fails

You do not write anything for this. When a remote fails to load or throws while rendering, `@mfeflow/runtime` reports it on `window`, and telemetry turns it into an `mfe.error` span with `mfe.name` and an `mfe.error.where` of `load`, `render`, `registry` or `errorLoadRemote:<lifecycle>`. Failures that happened before telemetry started are replayed.

## Configure it

| Key                            | Meaning                                                                                  | Default |
| ------------------------------ | ---------------------------------------------------------------------------------------- | ------- |
| `otlpEndpoint`                 | Full OTLP/HTTP traces URL. Empty keeps telemetry off.                                    | `""`    |
| `traceSampleRatio`             | Share of new traces recorded, 0 to 1. A trace that started elsewhere keeps its decision. | `1`     |
| `propagateTraceHeaderCorsUrls` | URL prefixes of other origins that get a `traceparent` header.                           | `[]`    |

These live in the runtime config, and `pnpm check:runtime-config` checks the URL, the ratio and the list. The feature has no install prompts.

More options are on `createOtelProvider` in `apps/shell/src/telemetry/init.ts`:

| Option          | Meaning                                                   | Default        |
| --------------- | --------------------------------------------------------- | -------------- |
| `recordQuery`   | Keep the query string on `url.full`                       | `false`        |
| `webVitals`     | Record Core Web Vitals as spans                           | `true`         |
| `exportDelayMs` | How long spans wait for a batch                           | `5000`         |
| `exporter`      | Replace the OTLP exporter, for example with a console one | OTLP over HTTP |

## How it works

`initTelemetry` takes a function that returns the provider. The SDK chunk is requested after the page has loaded, the next frame has painted and the browser is idle, or after 3 seconds if the tab is hidden and never paints. Until then, error reports and web vitals are queued (the last 50) and replayed. Spans started before the provider is ready are not recorded.

Once running, `getTracer(name)` stamps `mfe.name`, and `mfe.version` if you pass one. Spans created without a name, such as the `fetch` span from the instrumentation, inherit their parent's, so a trace reads by remote. Resource attributes are `service.name`, `service.version` and `deployment.environment.name`, which comes from `environment` in the runtime config. Core Web Vitals (`CLS`, `FCP`, `INP`, `LCP`, `TTFB`) become `web_vital.*` spans tagged `mfe.name = shell`.

Same-origin `fetch` requests get a `traceparent` header. Other origins get one only if they match a prefix in `propagateTraceHeaderCorsUrls`, and that server must allow the header in CORS. Requests to the OTLP endpoint itself are never traced.

### What leaves the browser

Spans are scrubbed before export. `url.full` and `http.url` are cut to origin and path, and the query of `http.target` and `url.query` is dropped, because tokens and email addresses end up in them. Userinfo (`user:pass@host`) and the fragment are always removed. `reportError` sends at most 4 KB of message and 4 KB of stack per error.

### Why the context manager is a stack

A `fetch` can only be a child of the click span if the SDK knows which span is active when `fetch` runs. That is the context manager's job. We measured it on 2026-11-01 with `@opentelemetry/sdk-trace` 3.0.0 and `@opentelemetry/context-zone` 3.0.0 plus zone.js 0.16.3, in Chrome, with the fetch instrumentation:

| Where the `fetch` is called                   | Stack  | Zone    | Zone, `async` downleveled to ES2016 |
| --------------------------------------------- | ------ | ------- | ----------------------------------- |
| synchronously in `startActiveSpan`'s callback | child  | child   | child                               |
| in a `.then()`                                | lost   | child   | child                               |
| in a `setTimeout`                             | lost   | child   | child                               |
| after a native `await`                        | lost   | lost    | child                               |
| a second `fetch` after `await`ing the first   | lost   | lost    | child                               |
| Added to the bundle, gzipped                  | 0.4 KB | 13.6 KB | 13.6 KB + the downleveling          |

The default is the stack manager. zone.js has to patch `Promise` and the timers before application code runs, so it would load on the critical path. Without downleveling, zone fixes `.then()` and timers but not native `await`, which modern code uses. Downleveling to ES2016 is the only setup where zone is right everywhere, and it changes how every app compiles. Starting the `fetch` inside the callback works with both and costs nothing.

## Gotchas

:::tip
If you need a span to survive an `await`, capture the context before it and run the call in it with `context.with(context.active(), ...)` from `@opentelemetry/api` in the shell. Then hand your remotes a function that does it.
:::

- **Keeping the query string.** Pass `recordQuery: true` to `createOtelProvider` only for a backend you trust with whatever your URLs carry. Userinfo and the fragment are still removed.
- **Adding env-t3 later.** The keys move into the schema and the environment files. Delete `apps/shell/public/config/runtime-config.json`, or doctor reports it as missing `environment`.
- **Versions.** The OpenTelemetry JavaScript SDK split into two lines in October 2026. This feature uses the 3.x packages (`sdk-trace`, `core`, `resources`) with `@opentelemetry/api` 1.10. The exporter and the fetch instrumentation (0.300.0) are experimental packages, and `@mfeflow/telemetry/otel` is the only place that imports them.

## Reference

- [env-t3](/features/env-t3), where the three keys are declared and checked
- [Runtime config](/concepts/runtime-config)
- [Cost model](/concepts/cost-model), for what shared code costs a page
- [`@mfeflow/telemetry` README](https://github.com/mfeflow/mfeflow/tree/main/packages/telemetry)
