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
  resetRegistryBeaconForTests,
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
  resetRegistryBeaconForTests();
});

afterEach(() => {
  resetRegistryBeaconForTests();
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

  it('makes ids with getRandomValues, which needs no secure origin', () => {
    const random = vi.spyOn(crypto, 'getRandomValues');
    const secure = vi.spyOn(crypto, 'randomUUID');
    const id = clientId();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(random).toHaveBeenCalled();
    expect(secure).not.toHaveBeenCalled();
  });
});

const entry = (remote: string, version: string, errors = 0) => ({
  remote,
  version,
  loads: 1,
  errors,
});

describe('createBeaconReporter', () => {
  it('sends a whole page as one request, on pagehide', () => {
    const { sent, send } = collector();
    const reporter = createBeaconReporter(TARGET, send, 'client-a');
    reporter.load('cart', '2.0.0');
    reporter.load('cart', '2.0.0');
    reporter.load('catalog', '1.0.0');
    expect(sent).toEqual([]);
    window.dispatchEvent(new Event('pagehide'));
    expect(sent).toEqual([
      {
        url: TARGET.url,
        body: {
          env: 'prod',
          u: 'client-a',
          entries: [entry('cart', '2.0.0'), entry('catalog', '1.0.0')],
        },
      },
    ]);
    reporter.stop();
  });

  it('uses the stored client id by default, the one sent as u on the index', () => {
    const { sent, send } = collector();
    const reporter = createBeaconReporter(TARGET, send);
    reporter.load('cart', '1.0.0');
    reporter.flush();
    expect(sent[0]?.body).toMatchObject({ u: clientId() });
    reporter.stop();
  });

  it('counts a remote error once, as a load that failed', () => {
    const { sent, send } = collector();
    const reporter = createBeaconReporter(TARGET, send, 'c');
    reporter.load('cart', '2.0.0');
    fail('cart', '2.0.0');
    fail('cart', '2.0.0');
    fail('shop', '3.0.0');
    reporter.flush();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.body).toMatchObject({
      entries: [entry('cart', '2.0.0', 1), entry('shop', '3.0.0', 1)],
    });
    reporter.stop();
  });

  it('ignores errors that name no version, since the server cannot place them', () => {
    const { sent, send } = collector();
    const reporter = createBeaconReporter(TARGET, send, 'c');
    fail('cart');
    reporter.flush();
    expect(sent).toEqual([]);
    reporter.stop();
  });

  it('sends when the page is hidden, not when it is shown, and only once', () => {
    const { sent, send } = collector();
    const reporter = createBeaconReporter(TARGET, send, 'c');
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

  it('does not report a load again after a flush, but sends a later error', () => {
    const { sent, send } = collector();
    const reporter = createBeaconReporter(TARGET, send, 'c');
    reporter.load('cart', '1.0.0');
    reporter.flush();
    reporter.load('cart', '1.0.0');
    reporter.load('shop', '1.0.0');
    reporter.flush();
    expect(sent.map((s) => s.body)).toMatchObject([
      { entries: [entry('cart', '1.0.0')] },
      { entries: [entry('shop', '1.0.0')] },
    ]);
    fail('cart', '1.0.0');
    reporter.flush();
    fail('cart', '1.0.0');
    reporter.load('cart', '1.0.0');
    reporter.flush();
    expect(sent).toHaveLength(3);
    expect(sent[2]?.body).toMatchObject({ entries: [entry('cart', '1.0.0', 1)] });
    reporter.stop();
  });

  it('caps what one page sends at 20 entries in one request', () => {
    const { sent, send } = collector();
    const reporter = createBeaconReporter(TARGET, send, 'c');
    for (let i = 0; i < 50; i += 1) reporter.load(`remote${String(i)}`, '1.0.0');
    reporter.flush();
    expect(sent).toHaveLength(1);
    expect(JSON.stringify(sent[0]?.body).match(/"remote"/g)).toHaveLength(20);
    reporter.stop();
  });

  it('stops listening after stop()', () => {
    const { sent, send } = collector();
    const reporter = createBeaconReporter(TARGET, send, 'c');
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
    expect(sent.map((s) => s.body)).toMatchObject([
      { env: 'prod', u: clientId(), entries: [entry('cart', '2.0.0')] },
    ]);
  });

  it('registers the plugin once, however often it is started', () => {
    const config = { registryBeacon: true };
    const first = startRegistryBeacon(config, [SERVER]);
    const second = startRegistryBeacon(config, [SERVER]);
    expect(second).toBe(first);
    expect(registerPlugins).toHaveBeenCalledTimes(1);
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
