import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { createNetGuard } from './net-guard';

const resolvesTo =
  (...addresses: string[]) =>
  (): Promise<string[]> =>
    Promise.resolve(addresses);

describe('net guard check', () => {
  it.each([
    ['loopback', ['127.0.0.1']],
    ['a public address beside a private one', ['93.184.216.34', '10.0.0.5']],
    ['link-local', ['169.254.169.254']],
    ['IPv6 loopback', ['::1']],
    ['IPv6 unique-local', ['fd12:3456::1']],
    ['IPv6 link-local with a zone', ['fe80::1%en0']],
    ['IPv4-mapped private', ['::ffff:10.0.0.1']],
    ['IPv4-mapped private in hex', ['::ffff:a00:1']],
  ])('refuses a name that resolves to %s', async (_why, addresses) => {
    const guard = createNetGuard({ resolve: resolvesTo(...addresses) });
    await expect(guard.check('https://public.example.com/x')).rejects.toMatchObject({
      code: 'MFEFLOW_E405',
    });
    await expect(guard.fetch('https://public.example.com/x')).rejects.toMatchObject({
      code: 'MFEFLOW_E405',
    });
  });

  it('refuses a private literal without asking DNS', async () => {
    let asked = 0;
    const guard = createNetGuard({
      resolve: () => {
        asked += 1;
        return Promise.resolve(['93.184.216.34']);
      },
    });
    await expect(guard.check('https://10.0.0.5/x')).rejects.toMatchObject({ code: 'MFEFLOW_E405' });
    await expect(guard.check('https://[::1]/x')).rejects.toMatchObject({ code: 'MFEFLOW_E405' });
    expect(asked).toBe(0);
  });

  it('accepts a name whose addresses are all public, and a public literal', async () => {
    const guard = createNetGuard({ resolve: resolvesTo('93.184.216.34', '2606:2800:220:1::1') });
    await expect(guard.check('https://public.example.com/x')).resolves.toBeUndefined();
    await expect(guard.check('https://93.184.216.34/x')).resolves.toBeUndefined();
  });

  it('refuses a name that does not resolve to anything', async () => {
    const guard = createNetGuard({ resolve: resolvesTo() });
    await expect(guard.check('https://empty.example.com/x')).rejects.toMatchObject({
      code: 'MFEFLOW_E405',
    });
  });
});

describe('net guard fetch', () => {
  it('connects to the address it checked, not to a second lookup', async () => {
    const seen: string[] = [];
    const server = http.createServer((req, res) => {
      seen.push(String(req.headers.host));
      res.writeHead(200, { 'x-test': 'yes' }).end('hello');
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    try {
      const { port } = server.address() as AddressInfo;
      let lookups = 0;
      const guard = createNetGuard({
        exempt: ['127.0.0.1'],
        resolve: () => {
          lookups += 1;
          return Promise.resolve(['127.0.0.1']);
        },
      });
      // rebind.test cannot be resolved by the system: reaching the server proves the pinned address
      const response = await guard.fetch(`http://rebind.test:${String(port)}/x`);
      expect(response.status).toBe(200);
      expect(response.headers?.get('x-test')).toBe('yes');
      expect(await response.text()).toBe('hello');
      expect(lookups).toBe(1);
      expect(seen).toEqual([`rebind.test:${String(port)}`]);
    } finally {
      await new Promise((done) => server.close(done));
    }
  });

  it('returns a redirect as it is, without following it', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(302, { location: 'https://elsewhere.example.com/' }).end();
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    try {
      const { port } = server.address() as AddressInfo;
      const guard = createNetGuard({ exempt: ['127.0.0.1'], resolve: resolvesTo('127.0.0.1') });
      const response = await guard.fetch(`http://rebind.test:${String(port)}/x`);
      expect(response.status).toBe(302);
      expect(response.headers?.get('location')).toBe('https://elsewhere.example.com/');
    } finally {
      await new Promise((done) => server.close(done));
    }
  });

  it('answers a 204 with no body and rejects when the connection fails', async () => {
    const server = http.createServer((_req, res) => res.writeHead(204).end());
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const { port } = server.address() as AddressInfo;
    const guard = createNetGuard({ exempt: ['127.0.0.1'], resolve: resolvesTo('127.0.0.1') });
    try {
      const response = await guard.fetch(`http://rebind.test:${String(port)}/x`);
      expect(response.status).toBe(204);
    } finally {
      await new Promise((done) => server.close(done));
    }
    await expect(guard.fetch(`http://rebind.test:${String(port)}/x`)).rejects.toThrow();
  });

  it('passes a literal address straight to fetch', async () => {
    const server = http.createServer((_req, res) => res.end('direct'));
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    try {
      const { port } = server.address() as AddressInfo;
      const guard = createNetGuard({ exempt: ['127.0.0.1'] });
      const response = await guard.fetch(`http://127.0.0.1:${String(port)}/`);
      expect(await response.text()).toBe('direct');
    } finally {
      await new Promise((done) => server.close(done));
    }
  });
});
