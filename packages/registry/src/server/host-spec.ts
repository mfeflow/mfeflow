import os from 'node:os';
import path from 'node:path';
import { s3Host } from '../s3';
import { localHost, type RegistryHost } from '../static';

type Env = Readonly<Record<string, string | undefined>>;

export type HostSpec =
  { kind: 'file'; dir: string } | { kind: 's3'; bucket: string; prefix: string };

const USAGE = 'the fallback host must be file:<dir> or s3://<bucket>[/prefix]';

/** `file:<dir>` or `s3://<bucket>[/prefix]`, the same spellings the CLI takes. */
export function parseHostSpec(spec: string, cwd: string): HostSpec {
  if (spec.startsWith('file:')) {
    const dir = spec.slice('file:'.length);
    if (dir === '') throw new Error(`${USAGE}; "${spec}" names no folder`);
    const home = /^~(?:[/\\](.*))?$/.exec(dir);
    if (home) return { kind: 'file', dir: path.resolve(os.homedir(), home[1] ?? '') };
    return { kind: 'file', dir: path.resolve(cwd, dir) };
  }
  if (spec.startsWith('s3://')) {
    const [bucket = '', ...rest] = spec.slice('s3://'.length).split('/');
    const parts = rest.filter((part) => part !== '');
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket))
      throw new Error(`${USAGE}; the bucket name is not valid`);
    if (parts.some((part) => part === '.' || part === '..'))
      throw new Error(`${USAGE}; the prefix cannot contain . or ..`);
    return { kind: 's3', bucket, prefix: parts.join('/') };
  }
  throw new Error(USAGE);
}

const present = (env: Env, name: string): string | undefined => {
  const value = env[name];
  return value === undefined || value === '' ? undefined : value;
};

/** Keys of `inner` under `prefix/`, so one bucket can hold several registries. */
function withPrefix(inner: RegistryHost, prefix: string): RegistryHost {
  if (prefix === '') return inner;
  const at = (key: string): string => `${prefix}/${key}`;
  return {
    put: (key, body, options) => inner.put(at(key), body, options),
    get: (key) => inner.get(at(key)),
    head: (key) => inner.head(at(key)),
  };
}

/** Opens the host. S3 settings and credentials come from the environment only. */
export function openHost(
  spec: HostSpec,
  env: Env,
  options: { fetch?: typeof fetch } = {},
): RegistryHost {
  if (spec.kind === 'file') return localHost(spec.dir);
  const accessKeyId = present(env, 'AWS_ACCESS_KEY_ID');
  const secretAccessKey = present(env, 'AWS_SECRET_ACCESS_KEY');
  const region = present(env, 'MFEFLOW_S3_REGION') ?? present(env, 'AWS_REGION');
  const missing = [
    ...(accessKeyId === undefined ? ['AWS_ACCESS_KEY_ID'] : []),
    ...(secretAccessKey === undefined ? ['AWS_SECRET_ACCESS_KEY'] : []),
    ...(region === undefined ? ['MFEFLOW_S3_REGION'] : []),
  ];
  if (accessKeyId === undefined || secretAccessKey === undefined || region === undefined)
    throw new Error(`set ${missing.join(', ')} to use s3://${spec.bucket}`);
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
