---
'@mfeflow/registry': minor
'mfeflow': minor
---

Run the registry server from the command line and from Docker. Set `MFEFLOW_REGISTRY_URL` (or pass `--registry-url`) and `mfeflow deploy`, `promote`, `rollback` and `status` talk to the server instead of writing a static index; without it nothing changes. New commands: `mfeflow rollout status|step|complete|abort`, `mfeflow kill` and `mfeflow restore`, and `--percent` with `--steps` on `deploy` and `promote` to start a percentage rollout. The token is read only from `MFEFLOW_REGISTRY_TOKEN`, never from a flag, and is scrubbed from every message and from `--json`. Plain http is refused unless the server is on localhost. Server answers map to the existing deploy error codes (E506 to E511) and exit 7.

`@mfeflow/registry` stops gracefully: on SIGTERM the server lets running requests finish, then closes. The package ships a Dockerfile, a compose example with MinIO and an image on ghcr.io for each release. A new `registry-server` feature wires a project to a server, and there are guides for running it and for its response times.
