---
'mfeflow': patch
---

`mfeflow mcp` follow-ups. `mfeflow_doctor` and a `shell` read from `mfeflow.json` now resolve the host name and refuse it if any address is private, loopback or link-local, and connect to the address they checked (E405). The detailed `mfeflow_inspect_project` hides URL credentials and tokens inside feature options. `mfeflow_plan` for `init` with a third-party feature repeats its dry run at apply, so a registry change is refused. `mfeflow promote` has a new `--expect-version` flag that refuses (E510) if the source environment serves another version; the MCP apply passes it.
