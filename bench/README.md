# bench

`time-to-running.ts` measures the DX contract (decision 0013): the time from `create-mfeflow` to a shell and its
remotes answering on `pnpm dev`.

One run is three timed steps, with the pnpm store already warm:

1. `create-mfeflow my-app --yes --no-install --local <checkout>` with the pinned fixture (`fixture.json`: shell,
   `catalog`, `cart`, `lint-oxlint`, `url-factory`, `env-t3`, `testing`). `--no-install` only so the install is timed on its own;
   `create-mfeflow` without it runs the same install.
2. `pnpm install`.
3. `pnpm dev` until `http://localhost:4300/` serves the dev registry and each remote's `mf-manifest.json` and entry
   script answer.

One untimed run comes first to fill the store. The median of 5 is written to `results/<date>.json` with the machine,
versions, commit and every run.

```sh
pnpm install && pnpm build          # --local links this checkout, so it must be built
node bench/time-to-running.ts       # or: pnpm --filter @mfeflow/bench bench
```

`RUNS` (default 5), `BENCH_DIR` (where projects go, default the OS temp folder; each is deleted after its run) and
`BENCH_FIXTURE` (another preset) change the run. The exit code is 1 when the median is 60 s or more.

What it does not measure: a cold pnpm store or cold network, and a browser rendering the page ("answers" means HTTP 200
on the shell and on each remote's entry, not first paint).

## registry-server.ts

Measures how fast the registry server moves people, on this machine.

One run, in a fresh env:

1. Deploys `cart` 1.0.0 and 2.0.0 through the server's API. The artifacts come from a small local HTTP server.
2. Sends `rollback`, and starts the clock just before the request. Reads `GET /v1/index/<env>` back to back until it shows 1.0.0. That is the first number.
3. Does the same with the static fallback `envs/<env>/index.json` that the server republishes to a local folder. That is the second.
4. Sends `kill` and times the same two things until the remote is gone.

One untimed run comes first. The median, 95th percentile and worst case of 20 runs go to `results/<date>-server.json` with the machine and the commit.

```sh
pnpm install && pnpm build
node bench/registry-server.ts        # or: pnpm --filter @mfeflow/bench bench:server
```

`RUNS` (default 20) changes the number of runs. The exit code is 1 if a rollback takes 10 seconds or more to show up in the index.

What it measures: the server's own work from the request to a fresh read. There is no network and no CDN.

What it does not measure:

- Network distance between people and the server.
- A CDN or a real S3 bucket as the fallback host.
- A returning visitor. The index is served with `Cache-Control: private, max-age=5`, so their browser may keep the old one for up to 5 more seconds.
- Load. One request at a time.
