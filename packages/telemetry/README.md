# @mfeflow/telemetry

Telemetry for micro-frontends behind one provider interface. The shell starts it once; remotes take a tracer. Ships an OpenTelemetry web provider (OTLP/HTTP export, `fetch` tracing, Core Web Vitals) meant to load after first render.

## Install

```sh
pnpm add @mfeflow/telemetry
```

In a project made with mfeflow, `mfeflow add telemetry-otel` does all of this.

## Usage

```ts
// shell, once: the SDK is a separate chunk, loaded after the first paint
import { initTelemetry } from '@mfeflow/telemetry';

initTelemetry(async () => {
  const { createOtelProvider } = await import('@mfeflow/telemetry/otel');
  return createOtelProvider({
    serviceName: 'shell',
    version: '1.0.0',
    environment: 'prod',
    otlpEndpoint: 'https://collector.example.com/v1/traces',
  });
});
```

```ts
// a remote
import { getTracer } from '@mfeflow/telemetry';

const tracer = getTracer('cart'); // every span carries mfe.name = cart
tracer.startActiveSpan('cart.click', (span) => {
  void fetch('/api/orders').finally(() => span.end()); // start the fetch before any await
});
```

Remote failures reported by `@mfeflow/runtime` are forwarded through the `window` event it fires; nothing to wire.

## Module Federation sharing

Bucket: **singleton**. Share `@mfeflow/telemetry` (`@mfeflow/rsbuild` does). `@mfeflow/telemetry/otel` is imported by the shell only, through a dynamic `import()`. Its exporter and instrumentation packages are 0.x (experimental) OpenTelemetry releases.

## Links

- [mfeflow repository](https://github.com/mfeflow/mfeflow) and its README
- [Documentation](https://mfeflow.github.io/mfeflow/)

MIT licensed.
