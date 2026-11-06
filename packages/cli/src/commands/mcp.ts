import type { ArgsDef } from 'citty';
import { assertKnownFlags, GLOBAL_ARGS } from '../args';
import type { McpResult } from '../output';
import type { Runtime } from '../runtime';
import type { CliMain } from '../mcp/capture';

export const MCP_ARGS = {
  'allow-registry-writes': {
    type: 'boolean',
    description: 'Also offer the promote and rollback tools (they change what visitors get)',
  },
  ...GLOBAL_ARGS,
} as const satisfies ArgsDef;

/** Serves MCP on stdin and stdout. The SDK is loaded here and nowhere else, so other commands never pay for it. */
export async function runMcp(
  rt: Runtime,
  args: Record<string, unknown>,
  raw: readonly string[],
  main: CliMain,
): Promise<McpResult> {
  assertKnownFlags(raw, MCP_ARGS);
  const { serveMcp } = await import('../mcp/server');
  await serveMcp({
    main,
    allowRegistryWrites: args['allow-registry-writes'] === true,
    env: rt.io.env,
  });
  return { ok: true, command: 'mcp' };
}
