import { describe, expect, it } from 'vitest';
import { configFromEnv, ConfigError, secretsOf } from './config';

describe('configFromEnv', () => {
  it('has safe defaults: loopback, port 8787, no CORS, 256 KiB bodies', () => {
    expect(configFromEnv({})).toEqual({
      port: 8787,
      bind: '127.0.0.1',
      dbPath: './mfeflow-registry.db',
      fallbackHost: undefined,
      artifactBaseUrl: undefined,
      corsOrigins: [],
      maxBodyBytes: 262_144,
    });
  });

  it('reads every setting and trims the artifact base', () => {
    const config = configFromEnv({
      MFEFLOW_REGISTRY_PORT: '9000',
      MFEFLOW_REGISTRY_BIND: '0.0.0.0',
      MFEFLOW_REGISTRY_DB: '/data/r.db',
      MFEFLOW_REGISTRY_FALLBACK_HOST: 's3://bucket/prefix',
      MFEFLOW_REGISTRY_ARTIFACT_BASE_URL: 'https://cdn.example.com/mfe/',
      MFEFLOW_REGISTRY_CORS_ORIGINS: 'https://a.example.com, https://b.example.com/path',
      MFEFLOW_REGISTRY_MAX_BODY_BYTES: '2048',
    });
    expect(config).toEqual({
      port: 9000,
      bind: '0.0.0.0',
      dbPath: '/data/r.db',
      fallbackHost: 's3://bucket/prefix',
      artifactBaseUrl: 'https://cdn.example.com/mfe',
      corsOrigins: ['https://a.example.com', 'https://b.example.com'],
      maxBodyBytes: 2048,
    });
  });

  it('treats empty values as unset', () => {
    expect(configFromEnv({ MFEFLOW_REGISTRY_PORT: '  ', MFEFLOW_REGISTRY_DB: '' }).port).toBe(8787);
  });

  it('reports every problem at once', () => {
    let error: unknown;
    try {
      configFromEnv({
        MFEFLOW_REGISTRY_PORT: 'eighty',
        MFEFLOW_REGISTRY_MAX_BODY_BYTES: '5',
        MFEFLOW_REGISTRY_ARTIFACT_BASE_URL: 'http://cdn.example.com',
        MFEFLOW_REGISTRY_CORS_ORIGINS: 'not a url,http://example.com',
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ConfigError);
    const message = error instanceof Error ? error.message : '';
    expect(message).toContain('MFEFLOW_REGISTRY_PORT must be a whole number');
    expect(message).toContain('MFEFLOW_REGISTRY_MAX_BODY_BYTES');
    expect(message).toContain('"http://cdn.example.com" must be https');
    expect(message).toContain('"not a url" is not a URL');
    expect(message).toContain('"http://example.com" must be https');
  });

  it('allows http on localhost, and refuses a base with a query or login', () => {
    expect(
      configFromEnv({ MFEFLOW_REGISTRY_ARTIFACT_BASE_URL: 'http://localhost:9000' })
        .artifactBaseUrl,
    ).toBe('http://localhost:9000');
    expect(() =>
      configFromEnv({ MFEFLOW_REGISTRY_ARTIFACT_BASE_URL: 'https://u:p@cdn.example.com' }),
    ).toThrow(/must not carry a query, fragment or login/);
    expect(() =>
      configFromEnv({ MFEFLOW_REGISTRY_ARTIFACT_BASE_URL: 'https://cdn.example.com?x=1' }),
    ).toThrow(/must not carry/);
    expect(() => configFromEnv({ MFEFLOW_REGISTRY_ARTIFACT_BASE_URL: '::' })).toThrow(/not a URL/);
  });
});

describe('secretsOf', () => {
  it('lists the credentials that are set', () => {
    expect(
      secretsOf({
        AWS_ACCESS_KEY_ID: 'AKIA1',
        AWS_SECRET_ACCESS_KEY: 's3cret',
        AWS_SESSION_TOKEN: '',
      }),
    ).toEqual(['AKIA1', 's3cret']);
  });
});
