import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { readPackageJson } from '../version';
import type { CliMain } from './capture';
import { capOutput } from './limits';
import { PlanStore } from './plans';
import { buildTools } from './tools';

export interface McpOptions {
  main: CliMain;
  allowRegistryWrites: boolean;
  env?: Readonly<Record<string, string | undefined>>;
  /** Tests move the clock to expire a plan. */
  now?: () => number;
  maxText?: number;
}

export function createMcpServer(options: McpOptions): McpServer {
  const server = new McpServer({ name: 'mfeflow', version: readPackageJson().version });
  const tools = buildTools(
    { main: options.main, plans: new PlanStore(options.now), env: options.env ?? process.env },
    options.allowRegistryWrites,
  );
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.shape,
        annotations: tool.annotations,
      },
      async (args) => {
        const { data, isError } = await tool.run(args);
        const capped = capOutput(data, options.maxText);
        return {
          content: [{ type: 'text' as const, text: capped.text }],
          structuredContent: capped.structured,
          ...(isError === true ? { isError: true } : {}),
        };
      },
    );
  }
  return server;
}

/** Serves MCP on stdin and stdout until the client goes away. Logs go to stderr, never stdout. */
export async function serveMcp(options: McpOptions, transport?: Transport): Promise<void> {
  const server = createMcpServer(options);
  const closed = new Promise<void>((resolve) => {
    // oxlint-disable-next-line unicorn/prefer-add-event-listener -- the SDK's onclose is a callback property, not an EventTarget
    server.server.onclose = resolve;
  });
  if (transport === undefined) {
    const stop = (): void => {
      void server.close();
    };
    process.stdin.once('end', stop);
    process.stdin.once('close', stop);
  }
  await server.connect(transport ?? new StdioServerTransport());
  await closed;
}
