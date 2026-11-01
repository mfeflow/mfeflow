import { isRegistryIndex, type RegistryIndex } from '@mfeflow/contracts';
import { describe, expect, it } from 'vitest';
import { FallbackPublisher } from './fallback';
import { memoryHost } from './fixtures/harness';

const indexOf = (version: string): RegistryIndex => ({
  env: 'prod',
  remotes: [{ name: 'cart', entry: `https://cdn.example.com/cart/${version}/m.json`, version }],
});

const versionPublished = (body: string): string | undefined => {
  const parsed: unknown = JSON.parse(body);
  return isRegistryIndex(parsed) ? parsed.remotes[0]?.version : undefined;
};

describe('FallbackPublisher', () => {
  it('writes the index it reads at publish time', async () => {
    const host = memoryHost();
    let version = '1.0.0';
    const logs: string[] = [];
    const fallback = new FallbackPublisher({
      host,
      stableIndex: async () => {
        await Promise.resolve();
        return indexOf(version);
      },
      log: (_level, message) => logs.push(message),
    });
    fallback.request('prod');
    version = '2.0.0';
    await fallback.idle();
    expect(host.puts).toHaveLength(1);
    expect(versionPublished(host.puts[0]?.body ?? '{}')).toBe('2.0.0');
    expect(logs).toEqual([]);
  });

  it('coalesces requests made while a write is running into one more write', async () => {
    const host = memoryHost();
    let version = 1;
    const fallback = new FallbackPublisher({
      host,
      stableIndex: () => Promise.resolve(indexOf(`${String(version)}.0.0`)),
      log: () => undefined,
    });
    fallback.request('prod');
    fallback.request('prod');
    fallback.request('prod');
    await fallback.idle();
    version = 2;
    fallback.request('prod');
    await fallback.idle();
    expect(host.puts.map((p) => versionPublished(p.body))).toEqual(['1.0.0', '1.0.0', '2.0.0']);
  });

  it('retries with backoff, logs without secrets, and gives up only when closed', async () => {
    const host = memoryHost();
    host.failNext = 3;
    const waits: number[] = [];
    const logs: string[] = [];
    const failing = host.put.bind(host);
    host.put = (key, body, options) =>
      host.failNext > 0
        ? Promise.reject(new Error('denied for AKIASECRET'))
        : failing(key, body, options);
    const fallback = new FallbackPublisher({
      host,
      stableIndex: () => Promise.resolve(indexOf('1.0.0')),
      log: (level, message) => logs.push(`${level} ${message}`),
      redact: (text) => text.replaceAll('AKIASECRET', '***'),
      backoffMs: (attempt) => 10 * (attempt + 1),
      sleep: (ms) => {
        waits.push(ms);
        host.failNext -= 1;
        return Promise.resolve();
      },
    });
    fallback.request('prod');
    await fallback.idle();
    expect(waits).toEqual([10, 20, 30]);
    expect(logs).toHaveLength(3);
    expect(logs.join('\n')).toContain('denied for ***');
    expect(logs.join('\n')).not.toContain('AKIASECRET');
    expect(host.puts).toHaveLength(1);
  });

  it('skips an env with no index and keeps going when the read fails', async () => {
    const host = memoryHost();
    let reads = 0;
    const logs: string[] = [];
    const fallback = new FallbackPublisher({
      host,
      stableIndex: () => {
        reads += 1;
        return reads === 1 ? Promise.resolve(undefined) : Promise.reject(new Error('db busy'));
      },
      log: (_l, m) => logs.push(m),
      backoffMs: () => 0,
      sleep: () => new Promise((resolve) => setTimeout(resolve, 1)),
    });
    fallback.request('gone');
    await fallback.idle();
    expect(host.puts).toEqual([]);
    expect(logs).toEqual([]);
    fallback.request('prod');
    await new Promise((resolve) => setTimeout(resolve, 5));
    await fallback.close();
    expect(logs[0]).toContain('db busy');
  });

  it('uses real timers by default and stops waiting when closed', async () => {
    const host = memoryHost();
    host.failNext = 1;
    const fallback = new FallbackPublisher({
      host,
      stableIndex: () => Promise.resolve(indexOf('1.0.0')),
      log: () => undefined,
      backoffMs: () => 20,
    });
    fallback.request('prod');
    await fallback.idle();
    expect(host.puts).toHaveLength(1);

    const slow = memoryHost();
    slow.failNext = 5;
    const stuck = new FallbackPublisher({
      host: slow,
      stableIndex: () => Promise.resolve(indexOf('1.0.0')),
      log: () => undefined,
      backoffMs: () => 60_000,
    });
    stuck.request('prod');
    await new Promise((resolve) => setTimeout(resolve, 5));
    const started = Date.now();
    await stuck.close();
    expect(Date.now() - started).toBeLessThan(2000);
    stuck.request('prod');
    await stuck.idle();
    expect(slow.puts).toEqual([]);
  });

  it('keeps the default backoff short at first and capped after', async () => {
    const waits: number[] = [];
    const host = memoryHost();
    host.failNext = 7;
    const fallback = new FallbackPublisher({
      host,
      stableIndex: () => Promise.resolve(indexOf('1.0.0')),
      log: () => undefined,
      sleep: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
    });
    fallback.request('prod');
    await fallback.idle();
    expect(waits).toEqual([1000, 2000, 4000, 8000, 16_000, 30_000, 30_000]);
  });
});
