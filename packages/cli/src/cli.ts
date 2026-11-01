import { stripVTControlCharacters } from 'node:util';
import { redactUrlsIn } from '@mfeflow/contracts';
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
import { BUDGET_ARGS, runBudget } from './commands/budget';
import {
  DEPLOY_ARGS,
  PROMOTE_ARGS,
  ROLLBACK_ARGS,
  runDeploy,
  runPromote,
  runRollback,
} from './commands/deploy';
import { DEV_ARGS, runDev } from './commands/dev';
import { FEATURES_ARGS, runFeatures } from './commands/features';
import { INIT_ARGS, runInit } from './commands/init';
import { REGISTRY_ARGS, runRegistry } from './commands/registry';
import {
  formatServerAction,
  KILL_ARGS,
  RESTORE_ARGS,
  ROLLOUT_CMD_ARGS,
  runKillCommand,
  runRolloutCommand,
} from './commands/server-mode';
import { runStatus, STATUS_ARGS } from './commands/status';
import { Cancelled, EXIT, exitCodeFor, reportOf, unexpectedReport, unexpectedText } from './exit';
import { commandHelp, rootHelp, type CommandHelp } from './help';
import { exitOf, type CliResult, type FailureResult } from './output';
import { realRuntime, type Runtime } from './runtime';
import { openServer } from './server-client';
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
    summary: 'add a remote, a shell, features or a typed env key to this project',
    usage:
      'mfeflow add remote <name> | mfeflow add shell <name> | mfeflow add <feature...> | mfeflow add env-key <KEY> --scope server|runtime --schema <expr>',
    args: ADD_ARGS,
    examples: [
      'mfeflow add remote checkout',
      'mfeflow add remote checkout --port 4320',
      'mfeflow add shell admin',
      'mfeflow add git-hooks',
      'mfeflow add @someone/analytics-segment --yes',
      'mfeflow add url-factory --dry-run',
      'mfeflow add env-t3 --option env-t3.validator=valibot',
      'mfeflow add env-key API_ORIGIN --scope server --schema "z.url()"',
      'mfeflow add env-key GTM_ID --scope runtime --schema "z.string().min(1)" --app shell',
    ],
    run: runAdd,
  },
  {
    name: 'features',
    summary: 'list and search the features you can add, from mfeflow and your registries',
    usage: 'mfeflow features [search] [options]',
    args: FEATURES_ARGS,
    examples: ['mfeflow features', 'mfeflow features lint', 'mfeflow features --json'],
    run: runFeatures,
  },
  {
    name: 'registry',
    summary: 'configure third-party feature registries, or build one to host',
    usage:
      'mfeflow registry add @namespace <url-template> | mfeflow registry list | mfeflow registry remove @namespace | mfeflow registry trust @namespace | mfeflow registry untrust @namespace | mfeflow registry build <dir> [--out dir]',
    args: REGISTRY_ARGS,
    examples: [
      'mfeflow registry add @acme https://acme.github.io/features/{name}.json',
      'mfeflow registry add @test http://127.0.0.1:4010/{name}.json   # plain http: loopback hosts only',
      'mfeflow registry list --json',
      'mfeflow registry remove @acme --dry-run',
      'mfeflow registry trust @acme   # a registry from a cloned repo is not asked until you trust it',
      'mfeflow registry build ./my-registry --out ./site',
    ],
    run: runRegistry,
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
  {
    name: 'budget',
    summary: 'measure the built JS of the shell and each remote against the cost-model budget',
    usage: 'mfeflow budget [options]',
    args: BUDGET_ARGS,
    examples: ['mfeflow budget', 'mfeflow budget --json', 'mfeflow budget --dist build'],
    run: runBudget,
  },
  {
    name: 'deploy',
    summary: "upload a remote's build to the registry host and point an environment at it",
    usage:
      'mfeflow deploy <remote> --env <env> [--version <v>] [--host <spec>] [--no-publish] [--percent <n> --steps <a,b>]',
    args: DEPLOY_ARGS,
    examples: [
      'mfeflow deploy catalog --env staging --host file:./site --base-url https://cdn.example.com',
      'mfeflow deploy catalog --env prod',
      'mfeflow deploy catalog --env prod --version 1.4.2 --dry-run',
      'mfeflow deploy catalog --env prod --no-publish   # upload, leave the index alone',
      'mfeflow deploy catalog --env prod --host s3://my-registry/mfe --json',
      'MFEFLOW_REGISTRY_URL=https://registry.example.com mfeflow deploy catalog --env prod --percent 10',
    ],
    run: runDeploy,
  },
  {
    name: 'promote',
    summary: 'point one environment at the version another environment serves; no upload',
    usage: 'mfeflow promote <remote> --from <env> --to <env> [--host <spec>]',
    args: PROMOTE_ARGS,
    examples: [
      'mfeflow promote catalog --from staging --to prod',
      'mfeflow promote catalog --from staging --to prod --dry-run',
    ],
    run: runPromote,
  },
  {
    name: 'rollback',
    summary: 'point an environment back at an earlier version; no rebuild, no upload',
    usage: 'mfeflow rollback <remote> --env <env> [--to <version>] [--host <spec>]',
    args: ROLLBACK_ARGS,
    examples: [
      'mfeflow rollback catalog --env prod',
      'mfeflow rollback catalog --env prod --to 1.3.0',
      'mfeflow rollback catalog --env prod --dry-run --json',
    ],
    run: runRollback,
  },
  {
    name: 'status',
    summary: 'show what each environment serves, the version before it, and drift',
    usage: 'mfeflow status [--env <env>] [--host <spec>]',
    args: STATUS_ARGS,
    examples: ['mfeflow status', 'mfeflow status --env prod --json'],
    run: runStatus,
  },
  {
    name: 'rollout',
    summary:
      'read or move a percentage rollout on the registry server: status, step, complete, abort',
    usage: 'mfeflow rollout step|complete|abort|status <remote> --env <env> [--registry-url <url>]',
    args: ROLLOUT_CMD_ARGS,
    examples: [
      'mfeflow promote catalog --from staging --to prod --percent 10 --steps 50,100',
      'mfeflow rollout status catalog --env prod',
      'mfeflow rollout step catalog --env prod',
      'mfeflow rollout complete catalog --env prod',
      'mfeflow rollout abort catalog --env prod --reason "checkout errors up"',
    ],
    run: async (rt, args, raw) => {
      const result = await runRolloutCommand(rt, args, raw, openServer(rt, args));
      if (args.json !== true) rt.io.stdout(formatServerAction(result));
      return result;
    },
  },
  {
    name: 'kill',
    summary: 'take a remote out of the served index at once (registry server only)',
    usage: 'mfeflow kill <remote> --env <env> [--reason <text>]',
    args: KILL_ARGS,
    examples: ['mfeflow kill checkout --env prod --reason "payments bug"'],
    run: async (rt, args, raw) => {
      const result = await runKillCommand(rt, args, raw, false, openServer(rt, args));
      if (args.json !== true) rt.io.stdout(formatServerAction(result));
      return result;
    },
  },
  {
    name: 'restore',
    summary: 'put a killed remote back in the served index (registry server only)',
    usage: 'mfeflow restore <remote> --env <env>',
    args: RESTORE_ARGS,
    examples: ['mfeflow restore checkout --env prod'],
    run: async (rt, args, raw) => {
      const result = await runKillCommand(rt, args, raw, true, openServer(rt, args));
      if (args.json !== true) rt.io.stdout(formatServerAction(result));
      return result;
    },
  },
  {
    name: 'dev',
    summary:
      'run the shell and every remote together, with a dev registry that follows the project',
    usage: 'mfeflow dev [options]',
    args: DEV_ARGS,
    examples: [
      'mfeflow dev',
      'mfeflow dev --only shell,catalog',
      'mfeflow dev --remote checkout=http://localhost:3001',
      'mfeflow dev --remote checkout=https://dev.example.com --allow-origin https://dev.example.com',
      'mfeflow dev --dry-run',
    ],
    run: runDev,
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
    if (verbose && mfe.cause !== undefined)
      rt.io.stderr(redactUrlsIn(unexpectedText(mfe.cause, true)));
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
    return result ? exitOf(result) : EXIT.ok;
  } catch (error) {
    return fail(error, rt, json, verbose);
  }
}
