import { configDirOf, type FetchLike } from '@mfeflow/core';
import { assetRoots, type AssetRoots } from './assets';
import { realBundlerHost, type BundlerHost } from './bundler';
import { createNetGuard } from './net-guard';
import { processIo, type Io } from './io';
import { realDevHost, type DevHost } from './proc';
import { clackPrompter, type Prompter } from './prompter';
import type { RegistryHost } from '@mfeflow/registry/static';
import { createSystem, type System } from './system';

/** Everything a command touches outside its own arguments. Tests replace the parts they watch. */
export interface Runtime {
  io: Io;
  prompter: Prompter;
  system: System;
  fetch: FetchLike;
  /** `fetch` for a URL read from a committed file: refuses a name that resolves to a private address. Absent means `fetch`. */
  publicFetch?: FetchLike;
  /** `fetch` for a `--against` address a person or agent typed, when it must not be trusted. Absent means `fetch`. */
  againstFetch?: FetchLike;
  roots: AssetRoots;
  /** Where per-user settings live, like the registries the user trusts. */
  configDir: string;
  /** Processes, signals and file watching for `mfeflow dev`. Defaults to the real ones. */
  dev?: DevHost;
  /** Finds and drives the bundler each app installed, for `mfeflow build`. Defaults to the real ones. */
  bundler?: BundlerHost;
  /** `fetch` for S3 hosts. Tests stand in for the network. */
  hostFetch?: typeof fetch;
  /** `fetch` for the registry server in server mode. Tests point it at a server on 127.0.0.1. */
  serverFetch?: typeof fetch;
  /** Wraps the registry host `deploy`, `promote`, `rollback` and `status` open. Tests inject a second writer. */
  wrapHost?: (host: RegistryHost) => RegistryHost;
}

export function realRuntime(io: Io = processIo()): Runtime {
  return {
    io,
    prompter: clackPrompter,
    system: createSystem(io),
    fetch: (url, init) => fetch(url, init),
    publicFetch: createNetGuard().fetch,
    roots: assetRoots(),
    configDir: configDirOf(io.env),
    dev: realDevHost(),
    bundler: realBundlerHost(),
  };
}
