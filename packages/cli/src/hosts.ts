import os from 'node:os';
import path from 'node:path';
import { MfeflowError } from '@mfeflow/core';
import { localHost, type RegistryHost } from '@mfeflow/registry/static';

export type HostSpec =
  { kind: 'file'; dir: string } | { kind: 's3'; bucket: string; prefix: string };

const USAGE = '--host must be file:<dir> or s3://<bucket>[/prefix]';

/** `file:<dir>` or `s3://<bucket>[/prefix]`. A folder is resolved against `cwd`. */
export function parseHostSpec(spec: string, cwd: string): HostSpec {
  if (spec.startsWith('file:')) {
    const dir = spec.slice('file:'.length);
    if (dir === '') throw new MfeflowError('E506', `${USAGE}; "${spec}" names no folder`);
    const home = /^~(?:[/\\](.*))?$/.exec(dir);
    if (home) return { kind: 'file', dir: path.resolve(os.homedir(), home[1] ?? '') };
    return { kind: 'file', dir: path.resolve(cwd, dir) };
  }
  if (spec.startsWith('s3://')) {
    const [bucket = '', ...rest] = spec.slice('s3://'.length).split('/');
    const parts = rest.filter((part) => part !== '');
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket))
      throw new MfeflowError('E506', `${USAGE}; the bucket name is not valid`);
    if (parts.some((part) => part === '.' || part === '..'))
      throw new MfeflowError('E506', `${USAGE}; the prefix cannot contain . or ..`);
    return { kind: 's3', bucket, prefix: parts.join('/') };
  }
  throw new MfeflowError('E506', USAGE);
}

/** The host as shown to people and in `--json`: never an endpoint or a credential. */
export function describeHost(host: HostSpec): string {
  if (host.kind === 'file') return `file:${host.dir}`;
  return host.prefix === '' ? `s3://${host.bucket}` : `s3://${host.bucket}/${host.prefix}`;
}

type Env = Readonly<Record<string, string | undefined>>;

const present = (env: Env, name: string): string | undefined => {
  const value = env[name];
  return value === undefined || value === '' ? undefined : value;
};

/** The secret values the environment holds, so no message can echo them. */
export function secretsOf(env: Env): string[] {
  return ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN']
    .map((name) => present(env, name))
    .filter((value) => value !== undefined);
}

export function redact(text: string, secrets: readonly string[]): string {
  return secrets.reduce((out, secret) => out.replaceAll(secret, '***'), text);
}

/** Keys of `inner` under `prefix/`, so one bucket can hold several registries. */
function withPrefix(inner: RegistryHost, prefix: string): RegistryHost {
  if (prefix === '') return inner;
  const at = (key: string): string => `${prefix}/${key}`;
  return {
    put: (key, body, options) => inner.put(at(key), body, options),
    get: (key) => inner.get(at(key)),
    head: (key) => inner.head(at(key)),
    ...(inner.list === undefined
      ? {}
      : {
          list: async (keyPrefix: string) =>
            (await inner.list?.(at(keyPrefix)))
              ?.filter((key) => key.startsWith(`${prefix}/`))
              .map((key) => key.slice(prefix.length + 1)) ?? [],
        }),
  };
}

export interface OpenOptions {
  env: Env;
  /** For tests: stands in for the network. */
  fetch?: typeof fetch;
}

/** Opens the host. S3 settings and credentials come from the environment only. */
export async function openHost(spec: HostSpec, options: OpenOptions): Promise<RegistryHost> {
  if (spec.kind === 'file') return localHost(spec.dir);
  const { s3Host } = await import('@mfeflow/registry/s3');
  const { env } = options;
  const accessKeyId = present(env, 'AWS_ACCESS_KEY_ID');
  const secretAccessKey = present(env, 'AWS_SECRET_ACCESS_KEY');
  const region = present(env, 'MFEFLOW_S3_REGION') ?? present(env, 'AWS_REGION');
  const missing = [
    ...(accessKeyId === undefined ? ['AWS_ACCESS_KEY_ID'] : []),
    ...(secretAccessKey === undefined ? ['AWS_SECRET_ACCESS_KEY'] : []),
    ...(region === undefined ? ['MFEFLOW_S3_REGION'] : []),
  ];
  if (accessKeyId === undefined || secretAccessKey === undefined || region === undefined)
    throw new MfeflowError('E506', `set ${missing.join(', ')} to use ${describeHost(spec)}`);
  const endpoint = present(env, 'MFEFLOW_S3_ENDPOINT');
  const sessionToken = present(env, 'AWS_SESSION_TOKEN');
  return withPrefix(
    s3Host({
      region,
      bucket: spec.bucket,
      accessKeyId,
      secretAccessKey,
      ...(endpoint === undefined ? {} : { endpoint }),
      ...(sessionToken === undefined ? {} : { sessionToken }),
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    }),
    spec.prefix,
  );
}
