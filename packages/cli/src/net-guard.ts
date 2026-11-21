import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { Readable } from 'node:stream';
import { isPrivateHost, redactUrl } from '@mfeflow/contracts';
import { PrivateTargetError, type FetchLike } from '@mfeflow/core';

export type Resolver = (host: string) => Promise<string[]>;

export interface NetGuardOptions {
  /** Every address a name resolves to. Tests stand in for DNS. */
  resolve?: Resolver;
  /** Hosts and addresses that skip the private check. Tests use it for a server on 127.0.0.1. */
  exempt?: readonly string[];
}

export interface NetGuard {
  /** Throws E405 unless every address behind the URL's host is public. */
  check(url: string): Promise<void>;
  /** A GET that refuses a private target and connects to the address it checked. */
  fetch: FetchLike;
}

const systemResolve: Resolver = async (host) =>
  (await dns.lookup(host, { all: true, verbatim: true })).map((entry) => entry.address);

const bare = (host: string): string => host.replace(/^\[|\]$/g, '');
/** The address without a zone, an IPv6 one spelled the way `URL` does so mapped forms are caught. */
const normalized = (address: string): string => {
  const plain = address.replace(/%.*$/, '');
  return plain.includes(':') ? bare(new URL(`http://[${plain}]/`).hostname) : plain;
};
const noBody = new Set([204, 205, 304]);

function refuse(url: string): never {
  throw new PrivateTargetError(`${redactUrl(url)} is a loopback or private address`);
}

function request(
  target: URL,
  addresses: readonly string[],
  signal: AbortSignal | undefined,
): Promise<Response> {
  const entries = addresses.map((address) => ({ address, family: net.isIP(address) }));
  const lookup: net.LookupFunction = (_host, options, done) => {
    const [first] = entries;
    if (options.all === true) done(null, entries);
    else if (first) done(null, first.address, first.family);
    else done(new Error('no address'), '', 0);
  };
  const client = target.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.request(
      target,
      { method: 'GET', lookup, ...(signal ? { signal } : {}) },
      (res) => {
        const headers = new Headers();
        for (const [key, value] of Object.entries(res.headers)) {
          for (const one of Array.isArray(value) ? value : [value]) {
            if (one !== undefined) headers.append(key, one);
          }
        }
        const status = res.statusCode ?? 502;
        if (noBody.has(status)) {
          res.resume();
          resolve(new Response(null, { status, headers }));
          return;
        }
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Node's web stream type is the same stream
        const body = Readable.toWeb(res) as ReadableStream<Uint8Array>;
        resolve(new Response(body, { status, headers }));
      },
    );
    req.once('error', reject);
    req.end();
  });
}

/**
 * Resolves the host once, refuses the request if any address is private, loopback, link-local or
 * unique-local, and connects to one of the addresses it checked, so a second lookup (DNS
 * rebinding) never happens.
 */
export function createNetGuard(options: NetGuardOptions = {}): NetGuard {
  const resolve = options.resolve ?? systemResolve;
  const exempt = new Set((options.exempt ?? []).map((entry) => entry.toLowerCase()));
  const skip = (name: string): boolean => exempt.has(bare(name).toLowerCase());

  /** The addresses to connect to, or undefined when the host is a literal that needs no lookup. */
  async function addressesOf(url: string): Promise<string[] | undefined> {
    const host = bare(new URL(url).hostname);
    if (skip(host)) return undefined;
    if (isPrivateHost(host)) refuse(url);
    if (net.isIP(host) !== 0) return undefined;
    const addresses = (await resolve(host)).map(normalized);
    if (addresses.length === 0) throw new PrivateTargetError(`${redactUrl(url)} did not resolve`);
    if (addresses.some((address) => !skip(address) && isPrivateHost(address))) refuse(url);
    return addresses;
  }

  return {
    check: async (url) => {
      await addressesOf(url);
    },
    fetch: async (url, init) => {
      const addresses = await addressesOf(url);
      if (addresses === undefined) return fetch(url, init);
      return request(new URL(url), addresses, init?.signal);
    },
  };
}
