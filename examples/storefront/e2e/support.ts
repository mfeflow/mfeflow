// Test doubles for the telemetry and analytics specs: an OTLP/HTTP collector that records the spans
// POSTed to it, a backend that reads `traceparent`, and helpers to drive the page.
import http from 'node:http';
import { expect, type Page } from '@playwright/test';

export interface CapturedSpan {
  name: string;
  traceId: string;
  spanId: string;
  parentSpanId: string;
  attributes: Record<string, string | number | boolean>;
}

export interface Collector {
  origin: string;
  spans: CapturedSpan[];
  /** Every URL the collector was asked for, to prove nothing else reached it. */
  paths: string[];
  close: () => Promise<void>;
}

export interface BackendRequest {
  path: string;
  traceparent: string | undefined;
}

export interface Backend {
  origin: string;
  requests: BackendRequest[];
  close: () => Promise<void>;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, traceparent, tracestate',
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

function attributeValue(value: unknown): string | number | boolean | undefined {
  if (!isRecord(value)) return undefined;
  for (const key of ['stringValue', 'intValue', 'doubleValue', 'boolValue']) {
    const found = value[key];
    if (typeof found === 'string' || typeof found === 'number' || typeof found === 'boolean') {
      return key === 'intValue' ? Number(found) : found;
    }
  }
  return undefined;
}

/** Reads the spans out of an OTLP/HTTP JSON body (`resourceSpans[].scopeSpans[].spans[]`). */
export function parseOtlp(body: unknown): CapturedSpan[] {
  const out: CapturedSpan[] = [];
  for (const resource of list(isRecord(body) ? body.resourceSpans : undefined)) {
    for (const scope of list(isRecord(resource) ? resource.scopeSpans : undefined)) {
      for (const span of list(isRecord(scope) ? scope.spans : undefined)) {
        if (!isRecord(span)) continue;
        const attributes: CapturedSpan['attributes'] = {};
        for (const attribute of list(span.attributes)) {
          if (!isRecord(attribute) || typeof attribute.key !== 'string') continue;
          const value = attributeValue(attribute.value);
          if (value !== undefined) attributes[attribute.key] = value;
        }
        out.push({
          name: String(span.name),
          traceId: String(span.traceId),
          spanId: String(span.spanId),
          parentSpanId: typeof span.parentSpanId === 'string' ? span.parentSpanId : '',
          attributes,
        });
      }
    }
  }
  return out;
}

function listen(server: http.Server): Promise<string> {
  return new Promise((resolve) => {
    // Port 0: the OS picks a free one, so the doubles never collide with the dev servers on 43xx.
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(
        `http://127.0.0.1:${String(typeof address === 'object' && address ? address.port : 0)}`,
      );
    });
  });
}

function closer(server: http.Server): () => Promise<void> {
  return () =>
    new Promise((resolve) => {
      server.closeAllConnections();
      server.close(() => {
        resolve();
      });
    });
}

export async function startCollector(): Promise<Collector> {
  const spans: CapturedSpan[] = [];
  const paths: string[] = [];
  const server = http.createServer((req, res) => {
    paths.push(`${req.method ?? ''} ${req.url ?? ''}`);
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS).end();
      return;
    }
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        spans.push(...parseOtlp(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
        res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' }).end('{}');
      } catch {
        res.writeHead(400, CORS).end();
      }
    });
  });
  const origin = await listen(server);
  return { origin, spans, paths, close: closer(server) };
}

export async function startBackend(): Promise<Backend> {
  const requests: BackendRequest[] = [];
  const server = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS).end();
      return;
    }
    const traceparent = req.headers.traceparent;
    requests.push({
      path: req.url ?? '',
      traceparent: typeof traceparent === 'string' ? traceparent : undefined,
    });
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' }).end('{"count":7}');
  });
  const origin = await listen(server);
  return { origin, requests, close: closer(server) };
}

/** `00-<trace id>-<parent span id>-<flags>` */
export function parseTraceparent(
  header: string | undefined,
): { traceId: string; parentSpanId: string; sampled: boolean } | undefined {
  const match = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/.exec(header ?? '');
  if (!match) return undefined;
  return {
    traceId: match[1] ?? '',
    parentSpanId: match[2] ?? '',
    sampled: (Number.parseInt(match[3] ?? '0', 16) & 1) === 1,
  };
}

const STATE = 'mfeflow.telemetry';

/** The name of the telemetry provider the page is running: `otel`, `noop`, or `none` before telemetry starts. */
export function providerName(page: Page): Promise<string> {
  return page.evaluate((key) => {
    const state: unknown = Reflect.get(globalThis, Symbol.for(key));
    const provider: unknown =
      typeof state === 'object' && state !== null ? Reflect.get(state, 'provider') : undefined;
    const name: unknown =
      typeof provider === 'object' && provider !== null ? Reflect.get(provider, 'name') : undefined;
    return typeof name === 'string' ? name : 'none';
  }, STATE);
}

/** Waits until the OpenTelemetry provider is running. Spans started earlier are not recorded. */
export async function telemetryRunning(page: Page): Promise<void> {
  await expect.poll(() => providerName(page)).toBe('otel');
}

/** Sends the spans the page has batched, instead of waiting for the batch timer. */
export async function flushSpans(page: Page): Promise<void> {
  await page.evaluate(async (key) => {
    const state: unknown = Reflect.get(globalThis, Symbol.for(key));
    const provider: unknown =
      typeof state === 'object' && state !== null ? Reflect.get(state, 'provider') : undefined;
    const flush: unknown =
      typeof provider === 'object' && provider !== null
        ? Reflect.get(provider, 'flush')
        : undefined;
    if (typeof flush === 'function') {
      const flushed: unknown = Reflect.apply(flush, provider, []);
      await flushed;
    }
  }, STATE);
}

/** Serves `config` as the runtime config in place of the one the shell ships. */
export async function runtimeConfig(page: Page, config: Record<string, unknown>): Promise<void> {
  await page.route('**/config/runtime-config.json', (route) =>
    route.fulfill({
      json: { environment: 'e2e', gtmId: '', otlpEndpoint: '', traceSampleRatio: 1, ...config },
    }),
  );
}
