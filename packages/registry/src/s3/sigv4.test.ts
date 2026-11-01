// Checks the signer against the AWS Signature Version 4 test suite (see fixtures/aws-sigv4-test-suite.ts).
import { describe, expect, it } from 'vitest';
import {
  SUITE_CREDENTIALS,
  SUITE_DATE,
  SUITE_SCOPE,
  SUITE_VECTORS,
} from './fixtures/aws-sigv4-test-suite';
import { encodeRfc3986, signRequest } from './sigv4';

const sign = (v: (typeof SUITE_VECTORS)[number]) =>
  signRequest({
    method: v.method,
    url: v.url,
    headers: v.headers,
    ...SUITE_SCOPE,
    credentials: SUITE_CREDENTIALS,
    date: SUITE_DATE,
  });

describe('signRequest against the AWS SigV4 test suite', () => {
  for (const vector of SUITE_VECTORS) {
    it(`${vector.name}: canonical request and signature`, () => {
      const signed = sign(vector);
      expect(signed.canonicalRequest).toBe(vector.canonicalRequest);
      expect(signed.signature).toBe(vector.signature);
    });
  }

  it('builds the Authorization header the suite expects', () => {
    const vector = SUITE_VECTORS[0];
    if (vector === undefined) throw new Error('no vectors');
    expect(sign(vector).headers).toEqual({
      'x-amz-date': '20150830T123600Z',
      authorization:
        'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31',
    });
  });
});

describe('signRequest beyond the suite', () => {
  const base = {
    method: 'PUT',
    url: 'https://s3.us-east-1.amazonaws.com/bucket/envs/prod/index.json',
    region: 'us-east-1',
    service: 's3',
    credentials: SUITE_CREDENTIALS,
    date: SUITE_DATE,
  };

  it('signs the session token as a header', () => {
    const signed = signRequest({
      ...base,
      credentials: { ...SUITE_CREDENTIALS, sessionToken: 'tok' },
    });
    expect(signed.headers['x-amz-security-token']).toBe('tok');
    expect(signed.headers.authorization).toContain(
      'SignedHeaders=host;x-amz-date;x-amz-security-token',
    );
    expect(signed.signature).not.toBe(signRequest(base).signature);
  });

  it('puts the body hash in the signature', () => {
    const a = signRequest({ ...base, body: 'one' });
    const b = signRequest({ ...base, body: 'two' });
    expect(a.signature).not.toBe(b.signature);
    expect(
      a.canonicalRequest.endsWith(
        '7692c3ad3540bb803c020b3aee66cd8887123234ea0c6e7143c0add73ff431ed',
      ),
    ).toBe(true);
  });

  it('keeps a port in the signed host', () => {
    const signed = signRequest({ ...base, url: 'http://127.0.0.1:9000/bucket/k' });
    expect(signed.canonicalRequest).toContain('host:127.0.0.1:9000');
  });

  it('encodes the path per segment, once', () => {
    const signed = signRequest({ ...base, url: 'https://h.example/b/a%20b/c%2Bd/e!f' });
    expect(signed.canonicalRequest.split('\n')[1]).toBe('/b/a%20b/c%2Bd/e%21f');
  });
});

describe('encodeRfc3986', () => {
  it('escapes what encodeURIComponent leaves', () => {
    expect(encodeRfc3986("a!'()*b c+d")).toBe('a%21%27%28%29%2Ab%20c%2Bd');
  });
});
