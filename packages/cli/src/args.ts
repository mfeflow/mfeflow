import path from 'node:path';
import { MfeflowError } from '@mfeflow/core';
import type { ArgsDef } from 'citty';

/** Flags every command takes. */
export const GLOBAL_ARGS = {
  yes: { type: 'boolean', alias: 'y', description: 'Take the defaults and never prompt' },
  preset: {
    type: 'string',
    description: 'Replay options from a JSON file or an https URL',
    valueHint: 'file|url',
  },
  json: { type: 'boolean', description: 'Print one JSON document on stdout, nothing else' },
  'dry-run': { type: 'boolean', description: 'Print the summary and diff, write nothing' },
  cwd: { type: 'string', description: 'Run as if started in this folder', valueHint: 'dir' },
  install: {
    type: 'boolean',
    default: true,
    description: 'Run the package manager after writing (--no-install to skip)',
  },
  verbose: { type: 'boolean', description: 'Show package manager output and stack traces' },
  local: {
    type: 'string',
    description: 'Link @mfeflow/* from a built mfeflow checkout (env MFEFLOW_LOCAL)',
    valueHint: 'path',
  },
  help: { type: 'boolean', alias: 'h', description: 'Show this help' },
} as const satisfies ArgsDef;

export interface Globals {
  yes: boolean;
  preset: string | undefined;
  json: boolean;
  dryRun: boolean;
  cwd: string;
  install: boolean;
  verbose: boolean;
  local: string | undefined;
  /** A person is at a terminal and has not opted out with --yes or --json. */
  canPrompt: boolean;
}

type Parsed = Record<string, unknown>;

export function text(args: Parsed, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

export function readGlobals(
  args: Parsed,
  env: Readonly<Record<string, string | undefined>>,
  cwd: string,
  interactive = false,
): Globals {
  const folder = text(args, 'cwd');
  const yes = args.yes === true;
  const json = args.json === true;
  return {
    yes,
    preset: text(args, 'preset'),
    json,
    dryRun: args['dry-run'] === true,
    cwd: folder === undefined ? cwd : path.resolve(cwd, folder),
    install: args.install !== false,
    verbose: args.verbose === true,
    local: text(args, 'local') ?? (env.MFEFLOW_LOCAL === '' ? undefined : env.MFEFLOW_LOCAL),
    canPrompt: interactive && !yes && !json,
  };
}

/** The names a raw argument list uses, without dashes, `=value` or a `no-` prefix. */
function flagNames(raw: readonly string[]): string[] {
  const names: string[] = [];
  for (const token of raw) {
    if (token === '--') break;
    if (!token.startsWith('-') || token === '-') continue;
    const body = token.replace(/^--?/, '').split('=')[0] ?? '';
    names.push(body);
  }
  return names;
}

/** Throws E107 for a flag the command does not declare; citty would quietly treat it as a boolean. */
export function assertKnownFlags(raw: readonly string[], defs: ArgsDef): void {
  const known = new Set<string>();
  for (const [name, def] of Object.entries(defs)) {
    if (def.type === 'positional') continue;
    known.add(name);
    if ('alias' in def) for (const alias of [def.alias ?? []].flat()) known.add(alias);
    if (def.type === 'boolean') known.add(`no-${name}`);
  }
  for (const name of flagNames(raw)) {
    if (!known.has(name)) {
      throw new MfeflowError('E107', `unknown flag "${name.length === 1 ? '-' : '--'}${name}"`);
    }
  }
}

/** Every value of a repeatable flag (`--option a=1 --option b=2`); citty keeps only the last. */
export function repeated(raw: readonly string[], name: string): string[] {
  const values: string[] = [];
  const flag = `--${name}`;
  for (const [index, token] of raw.entries()) {
    if (token === '--') break;
    if (token === flag) {
      const next = raw[index + 1];
      if (next !== undefined) values.push(next);
    } else if (token.startsWith(`${flag}=`)) {
      values.push(token.slice(flag.length + 1));
    }
  }
  return values;
}

/** A comma-separated flag or preset value as a list, trimmed, without empties. */
export function splitList(value: string | readonly string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const parts = typeof value === 'string' ? value.split(',') : value;
  return parts.map((part) => part.trim()).filter((part) => part !== '');
}
