import { configFromEnv, ConfigError, secretsOf } from './config';
import { assertSqliteSupport } from './node-version';
import { startRegistryServer } from './server';
import { openSqliteStorage } from './sqlite';
import { createToken, parseActions } from './tokens';

export interface MainIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

const USAGE = `usage:
  server serve
  server token create --env <env|*> --remote <name|*> --actions <a,b,...> [--label <text>]
  server token list
  server token revoke <id>

actions: read, deploy, promote, rollback, kill, admin

The server needs Node 22.13 or newer.`;

function flags(args: readonly string[]): { flags: Map<string, string>; rest: string[] } {
  const found = new Map<string, string>();
  const rest: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? '';
    if (!arg.startsWith('--')) {
      rest.push(arg);
      continue;
    }
    const [name = '', inline] = arg.slice(2).split(/=(.*)/s);
    const value = inline ?? args[(i += 1)];
    if (value === undefined) throw new Error(`--${name} needs a value`);
    found.set(name, value);
  }
  return { flags: found, rest };
}

async function tokenCommand(
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  io: MainIo,
): Promise<number> {
  const config = configFromEnv(env);
  const [verb, ...tail] = args;
  const { flags: f, rest } = flags(tail);
  const storage = await openSqliteStorage(config.dbPath);
  try {
    if (verb === 'create') {
      const token = await createToken(storage, {
        env: f.get('env') ?? '',
        remote: f.get('remote') ?? '',
        actions: parseActions(f.get('actions') ?? ''),
        ...(f.has('label') ? { label: f.get('label') ?? '' } : {}),
      });
      await storage.addAudit({
        at: new Date().toISOString(),
        tokenId: null,
        action: 'token.create',
        env: token.record.env,
        remote: token.record.remote,
        before: null,
        after: null,
        detail: { tokenId: token.id, actions: token.record.actions },
      });
      io.stdout(`${token.token}\n`);
      io.stderr(`Token ${token.id} created. This is the only time it is shown; store it now.\n`);
      return 0;
    }
    if (verb === 'list') {
      for (const t of await storage.listTokens())
        io.stdout(
          `${t.id}  env=${t.env} remote=${t.remote} actions=${t.actions.join(',')}${t.label === null ? '' : ` label=${t.label}`}${t.revokedAt === null ? '' : ' REVOKED'}\n`,
        );
      return 0;
    }
    if (verb === 'revoke') {
      const id = rest[0];
      if (id === undefined) throw new Error('token revoke needs a token id');
      const done = await storage.revokeToken(id, new Date().toISOString());
      if (done)
        await storage.addAudit({
          at: new Date().toISOString(),
          tokenId: null,
          action: 'token.revoke',
          env: null,
          remote: null,
          before: null,
          after: null,
          detail: { tokenId: id },
        });
      io.stdout(done ? `Revoked ${id}.\n` : `No active token ${id}.\n`);
      return done ? 0 : 1;
    }
    throw new Error(`unknown token command "${verb ?? ''}"\n${USAGE}`);
  } finally {
    await storage.close();
  }
}

/**
 * Entry for `node dist/server.js …` and the package bin. Returns an exit code; `serve` returns only
 * after the server stops.
 */
export async function main(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  io: MainIo,
  onReady?: (stop: () => Promise<void>) => void,
): Promise<number> {
  try {
    if (argv.includes('--help') || argv.includes('-h')) {
      io.stdout(`${USAGE}\n`);
      return 0;
    }
    assertSqliteSupport();
    const args = argv[0] === 'server' ? argv.slice(1) : argv;
    const [command = 'serve', ...rest] = args;
    if (command === 'token') return await tokenCommand(rest, env, io);
    if (command !== 'serve') {
      io.stderr(`${USAGE}\n`);
      return 2;
    }
    const config = configFromEnv(env);
    const running = await startRegistryServer({ config, env, secrets: secretsOf(env) });
    await new Promise<void>((resolve) => {
      const stop = async (): Promise<void> => {
        await running.close();
        resolve();
      };
      onReady?.(stop);
      process.once('SIGINT', () => void stop());
      process.once('SIGTERM', () => void stop());
    });
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(`${error instanceof ConfigError ? '' : 'error: '}${message}\n`);
    return 1;
  }
}
