import { stripVTControlCharacters } from 'node:util';
import { isMfeflowError, MfeflowError } from '@mfeflow/core';
import { defineCommand, runCommand, type CommandDef } from 'citty';
import { ADD_ARGS, runAdd } from './commands/add';
import {
  COMPAT_ARGS,
  DOCTOR_ARGS,
  runCheckCompat,
  runDoctor,
  runValidate,
  VALIDATE_ARGS,
} from './commands/doctor';
import { FEATURES_ARGS, runFeatures } from './commands/features';
import { INIT_ARGS, runInit } from './commands/init';
import { Cancelled, EXIT, exitCodeFor, reportOf, unexpectedReport, unexpectedText } from './exit';
import { exitForFindings } from './report';
import { commandHelp, rootHelp, type CommandHelp } from './help';
import type { CliResult, FailureResult } from './output';
import { realRuntime, type Runtime } from './runtime';
import { readPackageJson } from './version';

type Handler = (
  rt: Runtime,
  args: Record<string, unknown>,
  raw: readonly string[],
) => Promise<CliResult>;

interface Command extends CommandHelp {
  run: Handler;
}

export const COMMANDS: readonly Command[] = [
  {
    name: 'init',
    summary: 'create a new project: a shell and remotes',
    usage: 'mfeflow init [dir] [options]',
    args: INIT_ARGS,
    examples: [
      'mfeflow init my-app',
      'mfeflow init my-app --yes',
      'mfeflow init my-app --scope @acme --remotes catalog,cart,checkout --features lint-oxlint,git-hooks',
      'mfeflow init my-app --dry-run          # print the diff, write nothing',
      'mfeflow init my-app --yes --local ~/code/mfeflow   # link a local checkout',
    ],
    run: runInit,
  },
  {
    name: 'add',
    summary: 'add a remote, a shell or features to this project',
    usage: 'mfeflow add remote <name> | mfeflow add shell <name> | mfeflow add <feature...>',
    args: ADD_ARGS,
    examples: [
      'mfeflow add remote checkout',
      'mfeflow add remote checkout --port 4320',
      'mfeflow add shell admin',
      'mfeflow add git-hooks',
      'mfeflow add @someone/analytics-segment --yes',
      'mfeflow add url-factory --dry-run',
    ],
    run: runAdd,
  },
  {
    name: 'features',
    summary: 'list the features you can add',
    usage: 'mfeflow features [search] [options]',
    args: FEATURES_ARGS,
    examples: ['mfeflow features', 'mfeflow features lint', 'mfeflow features --json'],
    run: runFeatures,
  },
  {
    name: 'doctor',
    summary: 'check singletons, compatibility, config and drift; --fix repairs the safe ones',
    usage: 'mfeflow doctor [options]',
    args: DOCTOR_ARGS,
    examples: [
      'mfeflow doctor',
      'mfeflow doctor --fix',
      'mfeflow doctor --json',
      'mfeflow doctor --fix --dry-run',
    ],
    run: runDoctor,
  },
  {
    name: 'validate',
    summary: 'check mfeflow.json, every mfe.json and every registry entry against their schemas',
    usage: 'mfeflow validate [options]',
    args: VALIDATE_ARGS,
    examples: ['mfeflow validate', 'mfeflow validate --json'],
    run: runValidate,
  },
  {
    name: 'check-compat',
    summary: "check each remote's shared ranges against the shells it runs in",
    usage: 'mfeflow check-compat [options]',
    args: COMPAT_ARGS,
    examples: ['mfeflow check-compat', 'mfeflow check-compat --json'],
    run: runCheckCompat,
  },
];

function findCommand(name: string | undefined): Command | undefined {
  return COMMANDS.find((c) => c.name === name);
}

function toCitty(command: Command, capture: (result: CliResult) => void, rt: Runtime): CommandDef {
  return defineCommand({
    meta: { name: command.name, description: command.summary },
    args: command.args,
    async run({ args, rawArgs }) {
      capture(await command.run(rt, args, rawArgs));
    },
  });
}

function failure(error: MfeflowError): FailureResult {
  return { ok: false, error: reportOf(error), exitCode: exitCodeFor(error) };
}

/** Turns anything thrown into the exit code, and prints it the way the mode asks. */
function fail(error: unknown, rt: Runtime, json: boolean, verbose: boolean): number {
  if (error instanceof Cancelled) {
    // Only a terminal prompt can be cancelled, and --json never prompts.
    rt.io.stderr('Cancelled. Nothing was written.');
    return EXIT.cancelled;
  }
  const mfe =
    error instanceof Error && error.name === 'CLIError'
      ? new MfeflowError('E107', stripVTControlCharacters(error.message))
      : error;
  if (isMfeflowError(mfe)) {
    if (json) rt.io.stdout(JSON.stringify(failure(mfe), null, 2));
    else rt.io.stderr(mfe.format());
    if (verbose && mfe.cause !== undefined) rt.io.stderr(unexpectedText(mfe.cause, true));
    return exitCodeFor(mfe);
  }
  if (json) {
    const failed: FailureResult = {
      ok: false,
      error: unexpectedReport(error),
      exitCode: EXIT.unexpected,
    };
    rt.io.stdout(JSON.stringify(failed, null, 2));
  } else {
    rt.io.stderr(unexpectedText(error, verbose));
  }
  return EXIT.unexpected;
}

/** Runs the CLI with `argv` (without node and the script) and returns the exit code. */
export async function main(argv: readonly string[], rt: Runtime = realRuntime()): Promise<number> {
  const json = argv.includes('--json');
  const verbose = argv.includes('--verbose');
  try {
    const [first] = argv;
    if (first === '--version' || first === '-v') {
      rt.io.stdout(`mfeflow ${readPackageJson().version}`);
      return EXIT.ok;
    }
    if (first === undefined || first === 'help' || first === '--help' || first === '-h') {
      rt.io.stdout(rootHelp(COMMANDS));
      return EXIT.ok;
    }
    const command = findCommand(first);
    if (!command) {
      const names = COMMANDS.map((c) => c.name).join(', ');
      throw new MfeflowError(
        'E107',
        first.startsWith('-')
          ? `${first} comes before the command; write mfeflow <command> [options] (commands: ${names})`
          : `unknown command "${first}" (commands: ${names})`,
      );
    }
    const rest = argv.slice(1);
    if (rest.includes('--help') || rest.includes('-h')) {
      rt.io.stdout(commandHelp(command));
      return EXIT.ok;
    }
    let result: CliResult | undefined;
    await runCommand(
      toCitty(
        command,
        (r) => {
          result = r;
        },
        rt,
      ),
      { rawArgs: rest },
    );
    if (json && result) rt.io.stdout(JSON.stringify(result, null, 2));
    return result && 'findings' in result ? exitForFindings(result.findings) : EXIT.ok;
  } catch (error) {
    return fail(error, rt, json, verbose);
  }
}
