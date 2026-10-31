import type { ArgsDef } from 'citty';
import { GLOBAL_ARGS } from './args';
import { EXIT } from './exit';
import { readPackageJson } from './version';

export const DOCS_URL = 'https://mfeflow.dev';
export const REPO_URL = 'https://github.com/mfeflow/mfeflow';

export interface CommandHelp {
  name: string;
  summary: string;
  usage: string;
  args: ArgsDef;
  examples: readonly string[];
}

function flagLabel(name: string, def: ArgsDef[string]): string {
  const alias =
    'alias' in def
      ? [def.alias ?? []]
          .flat()
          .map((a) => `-${a}, `)
          .join('')
      : '';
  if (def.type === 'boolean') return `${alias}--${name}`;
  return `${alias}--${name} <${'valueHint' in def ? (def.valueHint ?? 'value') : 'value'}>`;
}

function table(args: ArgsDef, skip: ReadonlySet<string>): string[] {
  const rows = Object.entries(args)
    .filter(([name, def]) => def.type !== 'positional' && !skip.has(name))
    .map(([name, def]) => [flagLabel(name, def), def.description ?? ''] as const);
  const width = Math.max(0, ...rows.map(([label]) => label.length));
  return rows.map(([label, text]) => `  ${label.padEnd(width)}  ${text}`);
}

export function commandHelp(help: CommandHelp): string {
  const globals = new Set(Object.keys(GLOBAL_ARGS));
  const own = table(help.args, globals);
  const lines = [`mfeflow ${help.name} - ${help.summary}`, '', `Usage: ${help.usage}`];
  if (own.length > 0) lines.push('', 'Options:', ...own);
  lines.push('', 'Global options:', ...table(GLOBAL_ARGS, new Set()));
  lines.push('', 'Examples:', ...help.examples.map((example) => `  ${example}`));
  lines.push('', `Docs: ${DOCS_URL}`);
  return lines.join('\n');
}

export function exitCodesText(): string {
  return [
    `  ${String(EXIT.ok)}    success`,
    `  ${String(EXIT.unexpected)}    unexpected error`,
    `  ${String(EXIT.usage)}    bad command line (MFEFLOW_E107)`,
    `  ${String(EXIT.project)}    project or config problem (MFEFLOW_E1xx)`,
    `  ${String(EXIT.feature)}    feature problem (MFEFLOW_E2xx)`,
    `  ${String(EXIT.build)}    build or runtime problem (MFEFLOW_E3xx)`,
    `  ${String(EXIT.registry)}    registry problem (MFEFLOW_E4xx)`,
    `  ${String(EXIT.upgrade)}    upgrade problem (MFEFLOW_E5xx)`,
    `  ${String(EXIT.cancelled)}  cancelled at a prompt`,
  ].join('\n');
}

export function rootHelp(commands: readonly CommandHelp[]): string {
  const width = Math.max(...commands.map((c) => c.name.length));
  return [
    `mfeflow ${readPackageJson().version} - React micro-frontend platform kit`,
    '',
    'Usage: mfeflow <command> [options]',
    '',
    'Commands:',
    ...commands.map((c) => `  ${c.name.padEnd(width)}  ${c.summary}`),
    '',
    "Run `mfeflow <command> --help` for a command's options. Every command takes",
    '--yes, --preset, --json, --dry-run, --cwd, --no-install, --verbose.',
    '',
    'Examples:',
    '  npm create mfeflow@latest my-app -- --yes',
    '  mfeflow init my-app --remotes catalog,cart,checkout --dry-run',
    '  mfeflow add remote checkout',
    '  mfeflow features lint',
    '',
    'Exit codes:',
    exitCodesText(),
    '',
    `Docs: ${DOCS_URL}  Source: ${REPO_URL}`,
  ].join('\n');
}
