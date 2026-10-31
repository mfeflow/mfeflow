import type { FetchLike } from '@mfeflow/core';
import { assetRoots, type AssetRoots } from './assets';
import { processIo, type Io } from './io';
import { clackPrompter, type Prompter } from './prompter';
import { createSystem, type System } from './system';

/** Everything a command touches outside its own arguments. Tests replace the parts they watch. */
export interface Runtime {
  io: Io;
  prompter: Prompter;
  system: System;
  fetch: FetchLike;
  roots: AssetRoots;
}

export function realRuntime(io: Io = processIo()): Runtime {
  return {
    io,
    prompter: clackPrompter,
    system: createSystem(io),
    fetch: (url, init) => fetch(url, init),
    roots: assetRoots(),
  };
}
