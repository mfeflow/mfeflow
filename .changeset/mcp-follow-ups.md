---
'mfeflow': minor
'@mfeflow/core': patch
---

`mfeflow mcp` follow-ups. `mfeflow_doctor` and a `shell` read from `mfeflow.json` now resolve the host name and refuse it if any address is private, loopback or link-local, and connect to the address they checked (E405). A name that does not resolve is reported as unreachable (E307), not as a private address. Registries you trust keep their previous behaviour. The detailed `mfeflow_inspect_project` hides URL credentials and tokens inside feature options, including URLs inside longer text and the values of keys such as `token`, `password` and `apiKey`. `mfeflow_plan` for `init` with a third-party feature repeats its dry run at apply, so a registry change is refused. `mfeflow promote` has a new `--expect-version` flag that refuses (E510) if the source environment serves another version; the MCP apply passes it, and in server mode it is sent to the server too.
