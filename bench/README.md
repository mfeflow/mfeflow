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
