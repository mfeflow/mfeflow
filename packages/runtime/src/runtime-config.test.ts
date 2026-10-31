import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchRuntimeConfig,
  resetRuntimeConfigForTests,
  RUNTIME_CONFIG_KEY,
  RUNTIME_CONFIG_URL,
} from './runtime-config';

const fetchMock = vi.fn();

beforeEach(() => {
  resetRuntimeConfigForTests();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetRuntimeConfigForTests();
});

describe('fetchRuntimeConfig', () => {
  it('fetches the file once for any number of callers, and stores it for getRuntimeConfig', async () => {
    fetchMock.mockResolvedValue(Response.json({ gtmId: 'GTM-ABC1234' }));
    const [a, b, c] = await Promise.all([
      fetchRuntimeConfig(),
      fetchRuntimeConfig(),
      fetchRuntimeConfig(),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(RUNTIME_CONFIG_URL);
    expect(a).toEqual({ gtmId: 'GTM-ABC1234' });
    expect(b).toBe(a);
    expect(c).toBe(a);
    expect(Reflect.get(globalThis, RUNTIME_CONFIG_KEY)).toBe(a);
    await fetchRuntimeConfig();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('uses the config the shell already put on globalThis without fetching', async () => {
    Reflect.set(globalThis, RUNTIME_CONFIG_KEY, { environment: 'prod' });
    expect(await fetchRuntimeConfig()).toEqual({ environment: 'prod' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects, the same way for everyone and without a second fetch, when the file is missing', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 404 }));
    const first = fetchRuntimeConfig();
    const second = fetchRuntimeConfig();
    await expect(first).rejects.toThrow('answered 404');
    await expect(second).rejects.toThrow('answered 404');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects for a file that is not a JSON object', async () => {
    fetchMock.mockResolvedValue(Response.json(['a']));
    await expect(fetchRuntimeConfig()).rejects.toThrow('not a JSON object');
    expect(Reflect.get(globalThis, RUNTIME_CONFIG_KEY)).toBeUndefined();
  });

  it('rejects when the request itself fails', async () => {
    fetchMock.mockRejectedValue(new TypeError('offline'));
    await expect(fetchRuntimeConfig()).rejects.toThrow('offline');
  });
});
