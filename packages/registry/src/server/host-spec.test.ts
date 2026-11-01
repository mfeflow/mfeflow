import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openHost, parseHostSpec } from './host-spec';

describe('parseHostSpec', () => {
  it('reads file: and s3: specs', () => {
    expect(parseHostSpec('file:out', '/work')).toEqual({
      kind: 'file',
      dir: path.resolve('/work', 'out'),
    });
    expect(parseHostSpec('file:~/reg', '/work')).toEqual({
      kind: 'file',
      dir: path.resolve(os.homedir(), 'reg'),
    });
    expect(parseHostSpec('file:~', '/work')).toEqual({ kind: 'file', dir: os.homedir() });
    expect(parseHostSpec('s3://my-bucket', '/')).toEqual({
      kind: 's3',
      bucket: 'my-bucket',
      prefix: '',
    });
    expect(parseHostSpec('s3://my-bucket/a//b/', '/')).toEqual({
      kind: 's3',
      bucket: 'my-bucket',
      prefix: 'a/b',
    });
  });

  it('refuses what it cannot use', () => {
    expect(() => parseHostSpec('file:', '/')).toThrow(/names no folder/);
    expect(() => parseHostSpec('s3://B', '/')).toThrow(/bucket name/);
    expect(() => parseHostSpec('s3://bucket/../x', '/')).toThrow(/cannot contain/);
    expect(() => parseHostSpec('gs://bucket', '/')).toThrow(/file:<dir> or s3:/);
  });
});

describe('openHost', () => {
  it('opens a folder host', () => {
    expect(openHost({ kind: 'file', dir: os.tmpdir() }, {})).toHaveProperty('put');
  });

  it('names every missing S3 setting without printing any value', () => {
    expect(() =>
      openHost({ kind: 's3', bucket: 'b-ucket', prefix: '' }, { AWS_ACCESS_KEY_ID: 'AKIA' }),
    ).toThrow(/set AWS_SECRET_ACCESS_KEY, MFEFLOW_S3_REGION to use s3:\/\/b-ucket$/);
  });

  it('writes under the prefix, signed, through the given fetch', async () => {
    const seen: string[] = [];
    const host = openHost(
      { kind: 's3', bucket: 'b-ucket', prefix: 'reg' },
      {
        AWS_ACCESS_KEY_ID: 'AKIA',
        AWS_SECRET_ACCESS_KEY: 'secret',
        AWS_SESSION_TOKEN: 'tok',
        AWS_REGION: 'eu-west-1',
        MFEFLOW_S3_ENDPOINT: 'https://r2.example.com',
      },
      {
        fetch: (input) => {
          seen.push(String(input instanceof Request ? input.url : input));
          return Promise.resolve(new Response('', { status: 200, headers: { etag: '"x"' } }));
        },
      },
    );
    await host.put('envs/prod/index.json', '{}', {
      contentType: 'application/json',
      cacheControl: 'x',
    });
    expect(seen[0]).toBe('https://r2.example.com/b-ucket/reg/envs/prod/index.json');
    expect(await host.head('envs/prod/index.json')).toBeDefined();
    await host.get('envs/prod/index.json');
    expect(seen).toHaveLength(3);
  });

  it('opens an unprefixed bucket as is', () => {
    const host = openHost(
      { kind: 's3', bucket: 'b-ucket', prefix: '' },
      { AWS_ACCESS_KEY_ID: 'a', AWS_SECRET_ACCESS_KEY: 'b', AWS_REGION: 'us-east-1' },
    );
    expect(host).toHaveProperty('put');
  });
});
