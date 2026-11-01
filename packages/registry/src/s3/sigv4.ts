import crypto from 'node:crypto';

export interface Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export interface SignInput {
  method: string;
  url: string | URL;
  /** Headers sent with the request; every one is signed. `host` and `x-amz-date` are added. */
  headers?: Record<string, string>;
  body?: Uint8Array | string;
  region: string;
  service: string;
  credentials: Credentials;
  date: Date;
}

export interface Signed {
  /** What to send: the given headers plus `x-amz-date`, `x-amz-security-token` when there is a session token, and `authorization`. */
  headers: Record<string, string>;
  signature: string;
  canonicalRequest: string;
}

const sha256 = (data: Uint8Array | string): string =>
  crypto.createHash('sha256').update(data).digest('hex');
const hmac = (key: Uint8Array | string, data: string): Buffer =>
  crypto.createHmac('sha256', key).update(data).digest();

/** RFC 3986 encoding, which also escapes `!'()*` unlike `encodeURIComponent`. */
export const encodeRfc3986 = (value: string): string =>
  encodeURIComponent(value).replaceAll(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

function canonicalPath(url: URL): string {
  return url.pathname
    .split('/')
    .map((segment) => encodeRfc3986(decodeURIComponent(segment)))
    .join('/');
}

function canonicalQuery(url: URL): string {
  return [...url.searchParams.entries()]
    .map(([k, v]) => [encodeRfc3986(k), encodeRfc3986(v)] as const)
    .toSorted(([ak, av], [bk, bv]) =>
      ak === bk ? (av < bv ? -1 : av > bv ? 1 : 0) : ak < bk ? -1 : 1,
    )
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
}

const stamp = (date: Date): string => date.toISOString().replaceAll(/[:-]|\.\d{3}/g, '');

/** AWS Signature Version 4 with the signature in the `Authorization` header, as S3 and S3-compatible stores accept it. */
export function signRequest(input: SignInput): Signed {
  const url = new URL(input.url);
  const amzDate = stamp(input.date);
  const day = amzDate.slice(0, 8);
  const sent: Record<string, string> = { ...input.headers, 'x-amz-date': amzDate };
  if (input.credentials.sessionToken !== undefined)
    sent['x-amz-security-token'] = input.credentials.sessionToken;
  const signed = new Map<string, string>([['host', url.host]]);
  for (const [name, value] of Object.entries(sent))
    signed.set(name.toLowerCase(), value.trim().replaceAll(/\s+/g, ' '));
  const names = [...signed.keys()].toSorted();
  const signedHeaders = names.join(';');
  const canonicalRequest = [
    input.method.toUpperCase(),
    canonicalPath(url),
    canonicalQuery(url),
    ...names.map((n) => `${n}:${signed.get(n) ?? ''}`),
    '',
    signedHeaders,
    sha256(input.body ?? ''),
  ].join('\n');
  const scope = `${day}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
  const key = [day, input.region, input.service, 'aws4_request'].reduce<Buffer | string>(
    (k, part) => hmac(k, part),
    `AWS4${input.credentials.secretAccessKey}`,
  );
  const signature = hmac(key, stringToSign).toString('hex');
  return {
    headers: {
      ...sent,
      authorization: `AWS4-HMAC-SHA256 Credential=${input.credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    signature,
    canonicalRequest,
  };
}

export const payloadHash = (body: Uint8Array | string): string => sha256(body);
