import {
  context,
  propagation,
  SpanStatusCode,
  trace,
  type Context,
  type Span,
} from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  BatchSpanProcessor,
  ParentBasedSampler,
  StackContextManager,
  TraceIdRatioBasedSampler,
  TracerProvider,
  type ReadableSpan,
  type SpanExporter,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import type { ErrorContext, TelemetryProvider, WebVitalMetric } from './types';

export interface OtelOptions {
  /** `service.name`, e.g. `storefront-shell`. */
  serviceName: string;
  /** `service.version`: the shell's build version. */
  version: string;
  /** `deployment.environment.name`, e.g. `prod`. */
  environment: string;
  /** Full OTLP/HTTP traces URL, e.g. `https://collector.example.com/v1/traces`. From the runtime config. */
  otlpEndpoint: string;
  /** Share of traces to record, 0 to 1. A trace that starts elsewhere keeps its parent's decision. Default 1. */
  sampleRatio?: number | undefined;
  /**
   * Cross-origin URL prefixes that get a `traceparent` header on `fetch`, e.g. `https://api.example.com`.
   * Same-origin requests always get it. The server must allow the header in CORS.
   */
  propagateTraceHeaderCorsUrls?: readonly string[] | undefined;
  /**
   * Keep the query string on `url.full`. Off by default: queries carry tokens and personal data.
   * Userinfo (`user:pass@`) and the fragment are removed either way.
   */
  recordQuery?: boolean | undefined;
  /** Record Core Web Vitals as spans. Default true. */
  webVitals?: boolean | undefined;
  /** How long spans wait for a batch, in milliseconds. Default 5000. */
  exportDelayMs?: number | undefined;
  /** Replaces the OTLP exporter, e.g. with a console exporter while developing. */
  exporter?: SpanExporter | undefined;
}

const escape = (text: string) => text.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

/**
 * A URL prefix as an anchored pattern (the fetch instrumentation compares plain strings for
 * equality). A prefix that does not end in `/` must be followed by a path, a query, a fragment or the
 * end, so `https://api.example.com` does not match `https://api.example.com.evil.test`.
 */
export const prefixPattern = (prefix: string): RegExp =>
  new RegExp(`^${escape(prefix)}${prefix.endsWith('/') ? '' : '(?:$|[/?#])'}`);

export function clampRatio(ratio: number | undefined): number {
  if (ratio === undefined || Number.isNaN(ratio)) return 1;
  return Math.min(1, Math.max(0, ratio));
}

function mfeNameOf(span: Span | undefined): unknown {
  const attributes: unknown = span ? Reflect.get(span, 'attributes') : undefined;
  return typeof attributes === 'object' && attributes !== null
    ? Reflect.get(attributes, 'mfe.name')
    : undefined;
}

/** Gives a span without `mfe.name` its parent's, so the `fetch` a remote makes inside its span carries the tag too. */
export class MfeNameProcessor implements SpanProcessor {
  onStart(span: ReadableSpan & Span, parentContext: Context): void {
    if (mfeNameOf(span) !== undefined) return;
    const name = mfeNameOf(trace.getSpan(parentContext));
    if (typeof name === 'string') span.setAttribute('mfe.name', name);
  }
  onEnd(): void {}
  forceFlush(): Promise<void> {
    return Promise.resolve();
  }
  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

const URL_ATTRIBUTES = ['url.full', 'http.url'] as const;
const QUERY_ATTRIBUTES = ['url.query', 'http.target'] as const;
/** The longest message or stack a reported error may carry to the backend. */
export const MAX_ERROR_TEXT = 4096;

export function clip(text: string, max = MAX_ERROR_TEXT): string {
  return text.length > max ? `${text.slice(0, max)}...[truncated]` : text;
}

/** Origin and path of a URL, plus the query when asked. Never userinfo, never the fragment. */
export function scrubUrl(value: string, recordQuery: boolean): string {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.hash = '';
    if (!recordQuery) url.search = '';
    return url.href;
  } catch {
    const cut = value.search(/[?#]/);
    return cut === -1 ? value : value.slice(0, cut);
  }
}

/**
 * Rewrites the URL attributes of every finished span before the batch processor sees it, so a token
 * in `?token=` or `user:pass@` never reaches the exporter. It runs on end, not in the fetch
 * instrumentation's own hook, because that hook is skipped when the request fails early.
 */
export class UrlScrubProcessor implements SpanProcessor {
  constructor(private readonly recordQuery: boolean) {}
  onStart(): void {}
  onEnd(span: ReadableSpan): void {
    const attributes: Record<string, unknown> = span.attributes;
    for (const key of URL_ATTRIBUTES) {
      const value = attributes[key];
      if (typeof value === 'string') attributes[key] = scrubUrl(value, this.recordQuery);
    }
    if (!this.recordQuery) {
      for (const key of QUERY_ATTRIBUTES) {
        const value = attributes[key];
        if (typeof value === 'string') {
          const cut = value.indexOf('?');
          if (cut === -1) continue;
          attributes[key] = value.slice(0, cut);
        }
      }
      delete attributes['url.query'];
    }
  }
  forceFlush(): Promise<void> {
    return Promise.resolve();
  }
  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

async function watchWebVitals(record: (metric: WebVitalMetric) => void): Promise<void> {
  const { onCLS, onFCP, onINP, onLCP, onTTFB } = await import('web-vitals');
  const forward = (metric: WebVitalMetric) => {
    record({ name: metric.name, value: metric.value, rating: metric.rating, id: metric.id });
  };
  onCLS(forward);
  onFCP(forward);
  onINP(forward);
  onLCP(forward);
  onTTFB(forward);
}

/**
 * OpenTelemetry for the browser: one `TracerProvider` with the resource attributes, an OTLP/HTTP
 * batch exporter, `fetch` tracing and Core Web Vitals. The shell loads this module after first
 * render with a dynamic `import()`, so none of it is on the critical path.
 *
 * The context manager is the stack one: it follows synchronous calls, so a `fetch` started inside
 * `startActiveSpan` is a child of that span. It does not follow `await` or timers; see the docs
 * (zone.js was measured and does not follow native `await` either).
 */
export function createOtelProvider(options: OtelOptions): TelemetryProvider {
  const exporter = options.exporter ?? new OTLPTraceExporter({ url: options.otlpEndpoint });
  const batch = new BatchSpanProcessor({
    exporter,
    scheduledDelayMillis: options.exportDelayMs ?? 5000,
  });
  const provider = new TracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: options.serviceName,
      [ATTR_SERVICE_VERSION]: options.version,
      'deployment.environment.name': options.environment,
    }),
    sampler: new ParentBasedSampler({
      root: new TraceIdRatioBasedSampler(clampRatio(options.sampleRatio)),
    }),
    spanProcessors: [
      new MfeNameProcessor(),
      new UrlScrubProcessor(options.recordQuery === true),
      batch,
    ],
  });

  const recordWebVitals = (metric: WebVitalMetric): void => {
    const span = provider.getTracer('web-vitals').startSpan(`web_vital.${metric.name}`, {
      attributes: {
        'mfe.name': 'shell',
        'web_vital.name': metric.name,
        'web_vital.value': metric.value,
        'web_vital.rating': metric.rating,
        'web_vital.id': metric.id,
      },
    });
    span.end();
  };

  return {
    name: 'otel',
    init() {
      trace.setGlobalTracerProvider(provider);
      context.setGlobalContextManager(new StackContextManager().enable());
      propagation.setGlobalPropagator(new W3CTraceContextPropagator());
      registerInstrumentations({
        tracerProvider: provider,
        instrumentations: [
          new FetchInstrumentation({
            // The exporter's own POSTs must not become spans.
            ignoreUrls: [prefixPattern(options.otlpEndpoint)],
            propagateTraceHeaderCorsUrls: (options.propagateTraceHeaderCorsUrls ?? []).map(
              prefixPattern,
            ),
          }),
        ],
      });
      if (options.webVitals !== false) {
        watchWebVitals(recordWebVitals).catch((error: unknown) => {
          console.error('[mfeflow/telemetry] web vitals are not recorded', error);
        });
      }
    },
    getTracer: (mfeName) => provider.getTracer(mfeName),
    reportError(error: unknown, errorContext: ErrorContext) {
      const span = provider.getTracer(errorContext.mfe).startSpan('mfe.error', {
        attributes: {
          'mfe.name': errorContext.mfe,
          ...(errorContext.version === undefined ? {} : { 'mfe.version': errorContext.version }),
          ...(errorContext.where === undefined ? {} : { 'mfe.error.where': errorContext.where }),
        },
      });
      const message = clip(error instanceof Error ? error.message : String(error));
      span.recordException({
        name: error instanceof Error ? error.name : 'Error',
        message,
        ...(error instanceof Error && error.stack !== undefined
          ? { stack: clip(error.stack) }
          : {}),
      });
      span.setStatus({ code: SpanStatusCode.ERROR, message });
      span.end();
    },
    recordWebVitals,
    flush: () => provider.forceFlush(),
  };
}
