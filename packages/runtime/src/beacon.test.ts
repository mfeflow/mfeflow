import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REMOTE_ERROR_EVENT, rememberRemoteVersions } from './report';
import { resetRuntimeConfigForTests, RUNTIME_CONFIG_KEY } from './runtime-config';

const registerPlugins = vi.fn();
vi.mock('@module-federation/enhanced/runtime', () => ({
  registerPlugins,
  registerRemotes: vi.fn(),
}));

const {
  beaconTarget,
  clientId,
  CLIENT_ID_KEY,
  createBeaconReporter,
  registrySourcesWithBeacon,
  startRegistryBeacon,
  withClientId,
} = await import('./beacon');

const SERVER = 'https://registry.example.com/v1/index/prod';
const TARGET = { url: 'https://registry.example.com/v1/beacon', env: 'prod' };

type Sent = { url: string; body: unknown }[];
const collector = (): { sent: Sent; send: (url: string, body: string) => boolean } => {
  const sent: Sent = [];
  return {
    sent,
    send(url, body) {
      sent.push({ url, body: JSON.parse(body) });
      return true;
    },
  };
};

const fail = (mfe: string, version?: string): void => {
  window.dispatchEvent(
    new CustomEvent(REMOTE_ERROR_EVENT, {
      detail: {
        mfe,
        where: 'load',
        message: 'x',
        time: 0,
        ...(version === undefined ? {} : { version }),
      },
    }),
  );
};

beforeEach(() => {
  localStorage.clear();
  registerPlugins.mockClear();
});

afterEach(() => {
  resetRuntimeConfigForTests();
  vi.restoreAllMocks();
});

describe('beaconTarget', () => {
  it('finds the server index URL and derives the beacon URL and env', () => {
    expect(beaconTarget(['https://cdn.example.com/index.json', SERVER])).toEqual(TARGET);
    expect(beaconTarget(['https://registry.example.com/base/v1/index/staging?u=a'])).toEqual({
      url: 'https://registry.example.com/base/v1/beacon',
      env: 'staging',
    });
  });

  it('is undefined for a static index or nothing', () => {
    expect(
      beaconTarget(['/registry/index.json', 'https://cdn.example.com/envs/prod/index.json']),
    ).toBeUndefined();
    expect(beaconTarget([])).toBeUndefined();
  });
});

describe('client id', () => {
  it('is made once, kept, and added to server index URLs only', () => {
    const id = clientId();
    expect(id).toMatch(/^[\w.:-]{1,128}$/);
    expect(clientId()).toBe(id);
    expect(localStorage.getItem(CLIENT_ID_KEY)).toBe(id);
    expect(withClientId(SERVER)).toBe(`${SERVER}?u=${id}`);
    expect(withClientId(SERVER, 'abc')).toBe(`${SERVER}?u=abc`);
    expect(withClientId('/registry/index.json')).toBe('/registry/index.json');
    expect(withClientId('/v1/index/prod', 'abc')).toBe('/v1/index/prod?u=abc');
  });

  it('replaces a stored id that is not safe to send', () => {
    localStorage.setItem(CLIENT_ID_KEY, 'bad id!');
    expect(clientId()).not.toBe('bad id!');
  });

  it('falls back to one id per page when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(clientId()).toBe(clientId());
  });
});

describe('createBeaconReporter', () => {
  it('batches a page into one request per remote@version, sent on pagehide', () => {
    const { sent, send } = collector();
    const reporter = createBeaconReporter(TARGET, send);
    reporter.load('cart', '2.0.0');
    reporter.load('cart', '2.0.0');
    reporter.load('catalog', '1.0.0');
    expect(sent).toEqual([]);
    window.dispatchEvent(new Event('pagehide'));
    expect(sent).toEqual([
      {
        url: TARGET.url,
        body: { env: 'prod', remote: 'cart', version: '2.0.0', loads: 1, errors: 0 },
      },
      {
        url: TARGET.url,
        body: { env: 'prod', remote: 'catalog', version: '1.0.0', loads: 1, errors: 0 },
      },
    ]);
    reporter.stop();
  });

  it('counts a remote error once, as a load that failed', () => {
    const { sent, send } = collector();
    const reporter = createBeaconReporter(TARGET, send);
    reporter.load('cart', '2.0.0');
    fail('cart', '2.0.0');
    fail('cart', '2.0.0');
    fail('shop', '3.0.0');
    reporter.flush();
    expect(sent.map((s) => s.body)).toEqual([
      { env: 'prod', remote: 'cart', version: '2.0.0', loads: 1, errors: 1 },
      { env: 'prod', remote: 'shop', version: '3.0.0', loads: 1, errors: 1 },
    ]);
    reporter.stop();
  });

  it('ignores errors that name no version, since the server cannot place them', () => {
    const { sent, send } = collector();
    const reporter = createBeaconReporter(TARGET, send);
    fail('cart');
    reporter.flush();
    expect(sent).toEqual([]);
    reporter.stop();
  });

  it('sends when the page is hidden, not when it is shown, and only once', () => {
    const { sent, send } = collector();
    const reporter = createBeaconReporter(TARGET, send);
    reporter.load('cart', '1.0.0');
    const state = vi.spyOn(document, 'visibilityState', 'get');
    state.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(sent).toHaveLength(0);
    state.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(sent).toHaveLength(1);
    reporter.stop();
  });

  it('caps what one page sends', () => {
    const { sent, send } = collector();
    const reporter = createBeaconReporter(TARGET, send);
    for (let i = 0; i < 50; i += 1) reporter.load(`remote${String(i)}`, '1.0.0');
    reporter.flush();
    expect(sent).toHaveLength(20);
    reporter.stop();
  });

  it('stops listening after stop()', () => {
    const { sent, send } = collector();
    const reporter = createBeaconReporter(TARGET, send);
    reporter.stop();
    fail('cart', '1.0.0');
    window.dispatchEvent(new Event('pagehide'));
    expect(sent).toEqual([]);
  });
});

describe('startRegistryBeacon', () => {
  it('does nothing unless registryBeacon is true', () => {
    expect(startRegistryBeacon({}, [SERVER])).toBeUndefined();
    expect(startRegistryBeacon({ registryBeacon: 'yes' }, [SERVER])).toBeUndefined();
    expect(registerPlugins).not.toHaveBeenCalled();
  });

  it('does nothing without a registry server URL', () => {
    expect(startRegistryBeacon({ registryBeacon: true }, ['/registry/index.json'])).toBeUndefined();
    expect(registerPlugins).not.toHaveBeenCalled();
  });

  it('counts a load when Module Federation loads a remote with a known version', () => {
    const { sent, send } = collector();
    const reporter = startRegistryBeacon({ registryBeacon: true }, [SERVER], send);
    expect(reporter).toBeDefined();
    rememberRemoteVersions([{ name: 'cart', version: '2.0.0' }]);
    const [[plugins]] = registerPlugins.mock.calls as [
      [{ name: string; onLoad: (a: { id: string }) => void }[]],
    ];
    expect(plugins[0]?.name).toBe('mfeflow-beacon');
    plugins[0]?.onLoad({ id: 'cart/App' });
    plugins[0]?.onLoad({ id: 'unknown/App' });
    reporter?.flush();
    expect(sent.map((s) => s.body)).toEqual([
      { env: 'prod', remote: 'cart', version: '2.0.0', loads: 1, errors: 0 },
    ]);
    reporter?.stop();
  });
});

describe('registrySourcesWithBeacon', () => {
  it('adds the client id to server URLs and starts the reporter when the config asks', async () => {
    Reflect.set(globalThis, RUNTIME_CONFIG_KEY, { registryUrls: [SERVER], registryBeacon: true });
    const sources = await registrySourcesWithBeacon();
    expect(sources.urls).toEqual([`${SERVER}?u=${clientId()}`]);
    expect(registerPlugins).toHaveBeenCalledTimes(1);
  });

  it('leaves the URLs alone and starts nothing when the option is off', async () => {
    Reflect.set(globalThis, RUNTIME_CONFIG_KEY, { registryUrls: [SERVER] });
    expect((await registrySourcesWithBeacon()).urls).toEqual([SERVER]);
    expect(registerPlugins).not.toHaveBeenCalled();
  });

  it('leaves a static index alone even with the option on', async () => {
    Reflect.set(globalThis, RUNTIME_CONFIG_KEY, {
      registryUrls: ['/registry/index.json'],
      registryBeacon: true,
    });
    expect((await registrySourcesWithBeacon()).urls).toEqual(['/registry/index.json']);
    expect(registerPlugins).not.toHaveBeenCalled();
  });
});
