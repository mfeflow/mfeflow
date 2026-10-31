# telemetry-otel

OpenTelemetry for the browser behind `@mfeflow/telemetry`. Off by default.

```sh
mfeflow add telemetry-otel
```

Point the shell at an OTLP/HTTP endpoint in the runtime config:

```json
// apps/shell/public/config/runtime-config.prod.json
{
  "environment": "prod",
  "otlpEndpoint": "https://collector.example.com/v1/traces",
  "traceSampleRatio": 0.1,
  "propagateTraceHeaderCorsUrls": ["https://api.example.com"]
}
```

An empty `otlpEndpoint` (the default) keeps telemetry off: the SDK is never downloaded.

## What you get

| File                               | What it is for                                                                                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/shell/src/telemetry/init.ts` | The boot step. Reads the runtime config and, if there is an endpoint, loads the OpenTelemetry provider with a dynamic `import()` once the page is idle. |
| `apps/<remote>/src/telemetry.ts`   | `export const tracer = getTracer('<remote>')`. Every span it starts carries `mfe.name`.                                                                 |

Remote failures need no wiring. `@mfeflow/runtime` reports a failed load or a render error on `window`; telemetry
listens there, including for failures that happened before it started, and sends each as an `mfe.error` span with
`mfe.name` and where it failed (`load`, `render`, `registry`, `errorLoadRemote:…`). Runtime plugins import nothing, so
they cannot depend on telemetry, and they do not.

## Not on the critical path

`initTelemetry` takes a function that returns the provider. The shell's chunk with the SDK is requested after the
page has loaded, the next frame has painted and the browser is idle (or after 3 seconds, if the tab is hidden and never
paints). Until then `reportError` and `recordWebVitals` calls are kept (the last 50) and replayed. Spans started
before the provider is ready are not recorded.

On the storefront example the SDK chunk is 19.4 KB gzipped. The shell and the one-app baseline load it the same way,
so it does not count against the shell's overhead (see the cost model).

## Spans, traces and tagging

- `getTracer(name)` returns a tracer that stamps `mfe.name` (and `mfe.version` if you pass one). Take it once at
  import time; it follows the provider.
- Spans without `mfe.name`, such as the `fetch` span the instrumentation creates, get their parent's, so a trace
  reads by remote.
- Resource attributes: `service.name`, `service.version`, `deployment.environment.name` (the `environment` key of the
  runtime config).
- `fetch` is traced. Same-origin requests get a `traceparent` header. Other origins get one only if they are in
  `propagateTraceHeaderCorsUrls` (URL prefixes), and the server must allow the header in CORS. Requests to the OTLP
  endpoint itself are never traced.
- Core Web Vitals (`CLS`, `FCP`, `INP`, `LCP`, `TTFB`) become `web_vital.*` spans tagged `mfe.name = shell`.
- Spans leave in batches every 5 seconds and when the tab is hidden.

## Starting a trace from a click

```ts
import { tracer } from '../telemetry';

function onClick() {
  tracer.startActiveSpan('checkout.click', (span) => {
    void fetch('/api/orders').finally(() => span.end());
  });
}
```

Start the `fetch` inside the callback, before any `await`. See the next section for why.

## Context manager: stack, not zone

A `fetch` can only be a child of the click span if the SDK knows which span is active when `fetch` is called. That is
the context manager's job. Measured on 2026-11-01 with `@opentelemetry/sdk-trace` 3.0.0 and
`@opentelemetry/context-zone` 3.0.0 + zone.js 0.16.3, in Chrome, with the fetch instrumentation. Each cell is the
`fetch` started from a click span:

| Where the `fetch` is called                   | Stack  | Zone    | Zone, `async` downleveled to ES2016 |
| --------------------------------------------- | ------ | ------- | ----------------------------------- |
| synchronously in `startActiveSpan`'s callback | child  | child   | child                               |
| in a `.then()`                                | lost   | child   | child                               |
| in a `setTimeout`                             | lost   | child   | child                               |
| after a native `await`                        | lost   | lost    | child                               |
| a second `fetch` after `await`ing the first   | lost   | lost    | child                               |
| Added to the bundle, gzipped                  | 0.4 KB | 13.6 KB | 13.6 KB + the downleveling          |

The default is the **stack** manager:

- zone.js has to patch `Promise` and the timers before application code runs, so it would have to load on the critical
  path, which is what this feature avoids. It costs 13.1 KB gzipped more, per the table.
- Without downleveling, zone fixes `.then()` and timers, but not `await`, which is what modern code uses. Downleveling
  `async` functions to generators (an ES2016 target) is the only setup where zone is right everywhere, and it changes
  how every app is compiled.
- Starting the `fetch` inside the callback works with both and has no cost.

If you need `await` to keep the span, capture the context before it and run the call in it with
`context.with(context.active(), …)` from `@opentelemetry/api` in the shell, and hand your remotes a function.

## Runtime config

| Key                            | Meaning                                                                                  | Default |
| ------------------------------ | ---------------------------------------------------------------------------------------- | ------- |
| `otlpEndpoint`                 | Full OTLP/HTTP traces URL. Empty keeps telemetry off.                                    | `""`    |
| `traceSampleRatio`             | Share of new traces recorded, 0 to 1. A trace that started elsewhere keeps its decision. | `1`     |
| `propagateTraceHeaderCorsUrls` | URL prefixes of other origins that get `traceparent`.                                    | `[]`    |

|                  | Where the keys live                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------ |
| With `env-t3`    | In the schema and in every `runtime-config.<env>.json`, whichever feature was added first. |
| Without `env-t3` | In `apps/shell/public/config/runtime-config.json`, which the shell fetches as it is.       |

`pnpm check:runtime-config` checks the URL, the ratio and the list.

Adding `env-t3` later writes the keys into the schema and the environment files too. Delete
`apps/shell/public/config/runtime-config.json` then: the per-environment files replace it, and `mfeflow doctor`
reports it as missing `environment` until it is gone.

## Versions

OpenTelemetry's JavaScript SDK split into two lines in October 2026. `@opentelemetry/api` 1.10 and the 3.x packages
(`sdk-trace`, `core`, `resources`) go together; `sdk-trace-web` 2.12 still peers on `api` below 1.10. This feature
uses the 3.x line throughout, and composes what `WebTracerProvider` used to: `TracerProvider`, `StackContextManager`
and the W3C trace context propagator. The exporter and the instrumentations (`0.300.0`) are experimental packages;
`@mfeflow/telemetry/otel` is the only place that imports them.
