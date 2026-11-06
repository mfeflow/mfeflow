import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { redactUrl, redactUrlsIn } from './feature-registry';

const secret = fc.stringMatching(/^[A-Za-z0-9]{8,20}$/).map((s) => `sEcReT${s}`);
const secretName = fc.constantFrom(
  'token',
  'access_token',
  'api_key',
  'sig',
  'auth',
  'password',
  'secret',
  'X-Amz-Signature',
);
const safePair = fc.tuple(
  fc.constantFrom('page', 'q', 'lang', 'id'),
  fc.stringMatching(/^[a-z0-9]{1,6}$/),
);
const separator = fc.constantFrom('&', ';');

const urlWithSecrets = fc
  .record({
    scheme: fc.constantFrom('http', 'https'),
    path: fc.stringMatching(/^(\/[a-z0-9]{1,6}){0,3}$/),
    secrets: fc.array(fc.tuple(secretName, secret), { minLength: 1, maxLength: 3 }),
    plain: fc.array(safePair, { maxLength: 2 }),
    sep: separator,
    userinfo: fc.option(fc.tuple(fc.stringMatching(/^[a-z]{1,6}$/), secret), { nil: undefined }),
  })
  .map(({ scheme, path, secrets, plain, sep, userinfo }) => {
    const query = [
      ...plain.map(([k, v]) => `${k}=${v}`),
      ...secrets.map(([k, v]) => `${k}=${v}`),
    ].join(sep);
    const auth = userinfo === undefined ? '' : `${userinfo[0]}:${userinfo[1]}@`;
    return {
      url: `${scheme}://${auth}example.com${path}?${query}`,
      values: [...secrets.map(([, v]) => v), ...(userinfo === undefined ? [] : [userinfo[1]])],
    };
  });

describe('redactUrl fuzz', () => {
  it('never throws and is idempotent, for any text', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), (text) => {
        const once = redactUrl(text);
        expect(redactUrl(once)).toBe(once);
      }),
      { numRuns: 500 },
    );
  });

  it('leaves no token, key, signature or password value in the query or userinfo', () => {
    fc.assert(
      fc.property(urlWithSecrets, ({ url, values }) => {
        const out = redactUrl(url);
        for (const value of values) expect(out).not.toContain(value);
        expect(out.startsWith(url.slice(0, url.indexOf('://') + 3))).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it('keeps URLs with nothing secret unchanged', () => {
    const plainUrl = fc
      .tuple(fc.stringMatching(/^(\/[a-z0-9]{1,6}){0,3}$/), fc.array(safePair, { maxLength: 3 }))
      .map(
        ([path, pairs]) =>
          `https://example.com${path}?${pairs.map(([k, v]) => `${k}=${v}`).join('&')}`,
      );
    fc.assert(
      fc.property(plainUrl, (url) => {
        expect(redactUrl(url)).toBe(url);
      }),
      { numRuns: 200 },
    );
  });
});

describe('redactUrlsIn fuzz', () => {
  it('hides secrets in URLs quoted inside surrounding text', () => {
    const words = fc.stringMatching(/^[a-z ]{0,20}$/);
    fc.assert(
      fc.property(words, urlWithSecrets, words, (before, { url, values }, after) => {
        const out = redactUrlsIn(`${before} ${url} ${after}`);
        for (const value of values) expect(out).not.toContain(value);
      }),
      { numRuns: 200 },
    );
  });

  it('never throws, and leaves text without a URL alone', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), (text) => {
        const out = redactUrlsIn(text);
        if (!/https?:\/\//i.test(text)) expect(out).toBe(text);
      }),
      { numRuns: 500 },
    );
  });
});
