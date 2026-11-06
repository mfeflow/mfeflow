---
title: Use mfeflow from a coding agent
description: Run mfeflow mcp to let Claude Code, Cursor, VS Code or Codex inspect a project, plan a change, and apply it after you confirm. Tools, safety model and install lines.
---

# Use mfeflow from a coding agent

`mfeflow mcp` starts an [MCP](https://modelcontextprotocol.io) server on stdin and stdout. A coding agent that speaks MCP can then read your project, check it, and plan changes with mfeflow's own commands. It is part of the CLI, so there is nothing else to install.

::: warning
Available from the release after 0.8.0. Until then `npx -y mfeflow mcp` does not have the command.
:::

The tools run the same code as the CLI, in the same process, in `--json` mode. They do not start a shell or a child process, and the answers match what you get on the command line.

## Install

Claude Code:

```bash
claude mcp add mfeflow -- npx -y mfeflow mcp
```

Codex:

```bash
codex mcp add mfeflow -- npx -y mfeflow mcp
```

Cursor, in `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "mfeflow": { "command": "npx", "args": ["-y", "mfeflow", "mcp"] }
  }
}
```

VS Code, in `.vscode/mcp.json`:

```json
{
  "servers": {
    "mfeflow": { "type": "stdio", "command": "npx", "args": ["-y", "mfeflow", "mcp"] }
  }
}
```

## Tools

Every tool takes `cwd`, the absolute path of the project (a folder inside it works too). Every tool also takes `response_format`: `concise` is the default, `detailed` returns the full CLI document. Answers come back as structured data with a text copy, and the text is cut at 40,000 characters with a note when it is cut.

| Tool                      | Does                                                                                                           | Changes anything               |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `mfeflow_inspect_project` | Reads `mfeflow.json`: apps, features and versions, topology, repo kind, bundler                                | No                             |
| `mfeflow_search_features` | Lists features from mfeflow and your registries, with optional search text                                     | No                             |
| `mfeflow_validate`        | Checks `mfeflow.json`, every `mfeflow.app.json` and every registry entry                                       | No                             |
| `mfeflow_doctor`          | Runs the doctor checks, never `--fix`. Optional `against` for a deployed shell                                 | No                             |
| `mfeflow_registry_status` | What each environment serves, the version before it, and drift                                                 | No                             |
| `mfeflow_explain_error`   | Gives the title, fix and docs link for an `MFEFLOW_Exxx` code, or finds codes in a log                         | No                             |
| `mfeflow_plan`            | Plans `init`, `add_feature`, `add_remote` or `upgrade` as a dry run. Returns `plan_id`, a summary and the diff | No, it only remembers the plan |
| `mfeflow_apply_plan`      | Applies a plan by id, after you confirm                                                                        | Yes, writes files              |
| `mfeflow_registry_plan`   | Plans a `promote` or a `rollback` as a dry run. Only with `--allow-registry-writes`                            | No                             |
| `mfeflow_registry_apply`  | Runs that plan against the registry host. Only with `--allow-registry-writes`                                  | Yes, changes what visitors get |

Planned and applied changes do not install packages. Run `pnpm install` yourself afterwards.

## How changes are kept safe

- **Plan, then apply.** The agent cannot write by calling one tool. `mfeflow_plan` runs the command with `--dry-run` and shows the diff. Only `mfeflow_apply_plan` with the returned `plan_id` writes, and the agent should show you the diff first.
- **A plan expires after 10 minutes** and can be applied once. It is held in the server's memory, so restarting the server drops every plan.
- **A changed file stops it.** The plan records the SHA-256 of every file it touches, and of `mfeflow.json`. If any of them changed, or a file it meant to create now exists, the apply is refused. Make a new plan.
- **A plan belongs to one folder.** Applying it from a different `cwd` is refused.
- **Registry writes are off by default.** `mfeflow_registry_plan` and `mfeflow_registry_apply` exist only when the server starts with `--allow-registry-writes`. Add the flag to the command in your client config if you want them.
- **Tokens come from the environment.** The server reads the same variables as the CLI (`MFEFLOW_S3_ENDPOINT`, `AWS_ACCESS_KEY_ID` and the rest). No tool takes a token or a password as an argument, and a host with credentials in it is rejected.
- **A plan id is not a login.** Anyone who can talk to the server can apply a plan. The server runs as you, on your machine, over stdio.

The hints on each tool (`readOnlyHint`, `destructiveHint`) are set honestly, but they are hints for the client. The safety comes from the plan and apply steps above. A registry plan can only check the project files; it cannot check what is on the remote host, so the apply runs the CLI's own guards (create-only uploads, index compare-and-swap) against it.

## Try it

Ask your agent: "Add a remote called reviews, then run doctor." You should see it call `mfeflow_plan`, show you the diff for `reviews`, wait for your yes, call `mfeflow_apply_plan`, then call `mfeflow_doctor`.

To see the raw protocol without an agent:

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"hand","version":"1"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | npx mfeflow mcp
```

The second reply lists the tools. The server ends when its input closes.

## Related

- [CLI reference](/reference/cli) for the commands behind each tool.
- [Add a remote](/guide/adding-a-remote) and [Add features](/guide/adding-features).
- [Deploy and roll back](/guide/deploy-and-rollback) for what `promote` and `rollback` do.
