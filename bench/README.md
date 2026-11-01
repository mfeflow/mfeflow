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

## rollback-visible.ts

Measures how long a rollback takes to show up for a visitor, on a local file host.

One run:

1. Deploys `cart` 1.0.0 and `catalog` 1.0.0 and 2.0.0 with the real `mfeflow deploy` into a folder. The 2.0.0 build has a different heading.
2. A test server serves that folder, re-reading it on every request. The registry index goes out with `Cache-Control: public, max-age=60`.
3. Checks that a fresh page load shows 2.0.0.
4. Runs `mfeflow rollback catalog`, and starts the clock when the command exits.
5. Loads the page in a new browser context (no cache, no storage) until the heading is the 1.0.0 one, and stops the clock.

One untimed run comes first. The median of 5 is written to `results/<date>-rollback.json` with the machine, the commit, the browser and every run. The result is labelled `"host": "local file host"`.

```sh
pnpm install && pnpm build
pnpm --filter @storefront/shell build        # the storefront remotes and shell must be built
node bench/rollback-visible.ts               # or: pnpm --filter @mfeflow/bench bench:rollback
```

`RUNS` (default 5) changes the number of runs. `PW_CHANNEL=chrome` uses an installed Chrome instead of the Playwright download. If no browser can start, it fetches the index and the catalog's remote entry over HTTP instead, and `method` in the result says so. The result names the Phase 05 criterion (under 90 s) as context; the bench does not pass or fail against it.

What it measures: the work between the command exiting and a first-time visitor getting the old version, with nothing but a local disk and a local server in between.

What it does not measure:

- CDN edge caches. A CDN may keep the old index until its own time-to-live ends.
- Real S3 or R2 latency, or the time `mfeflow rollback` takes against a real bucket.
- A returning visitor. Their browser may keep the index for up to the 60 seconds of `max-age`, so for them the wait is that, not this number.

This is the floor, not a CDN number. A real-host figure needs credentials for a bucket.

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
