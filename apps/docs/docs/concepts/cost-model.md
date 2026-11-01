---
title: The cost model
description: The three budgets mfeflow checks (300 ms LCP, 32 KB shell JavaScript, 10 KB per remote), why they exist, how they are measured, and what the storefront example measured.
---

# The cost model

This page explains the limits mfeflow uses to decide whether federating a page costs too much. The numbers are defaults, and you can change them. They are stated openly so the cost of micro-frontends is something you measure, not a feeling.

## What does it cost to federate a page?

A federated page loads a shell, then each remote on the route. That is more JavaScript, more requests and more steps than the same page in one app. The cost model compares the two.

It sets three limits, each against the same pages built as one app.

| Limit     | Default | Meaning                                          |
| --------- | ------- | ------------------------------------------------ |
| LCP       | 300 ms  | Largest contentful paint the shell may add       |
| Shell JS  | 32 KB   | JavaScript the shell adds over the one-app build |
| Remote JS | 10 KB   | JavaScript each remote on the route adds         |

Sizes are gzip, with 1 KB equal to 1024 bytes. The defaults are in `COST_MODEL` in `@mfeflow/contracts`.

## Who checks what?

Only the sizes are checked by the CLI. `mfeflow budget` reads your build output.

```text
 pnpm build  ->  apps/*/dist  ->  mfeflow budget
                                   |- remote entry vs 10 KB
                                   |- shell vs baseline + 32 KB  (needs budget.baselineKb)
                                   '- LCP: not measured here
```

LCP needs a browser. It is measured by a performance job, such as Lighthouse in CI, which you run yourself. The CLI says so on every run.

The shell check needs a baseline. Put the initial gzip JavaScript of your pages built as one app into `budget.baselineKb`. Without it, the shell line says it was not checked. See [CI and budgets](/guide/ci-and-budgets).

## What does a real measurement look like?

The storefront example in the repository is checked against the cost model by a CI job called "cost model". It runs Lighthouse on the mobile preset with simulated throttling. [Run 41312499587](https://github.com/mfeflow/mfeflow/actions/runs/41312499587), from 2026-11-01, passed.

| Limit   | Budget | Measured |
| ------- | ------ | -------- |
| LCP     | 300 ms | +154 ms  |
| Shell   | 32 KB  | +31.1 KB |
| cart    | 10 KB  | 9.5 KB   |
| catalog | 10 KB  | 10.0 KB  |

Everything passes, but the shell and the catalog remote sit right at their limits. A small change to either can tip the job over.

An older run, kept in `examples/storefront/e2e/perf-summary.json` (2026-10-31), used a different target: a total page increase of 35 KB. That target was replaced by the per-part limits above. The whole page is still about 46 KB over the old total, which is why the per-part limits are the ones to watch.

The same older file records six steps that took one route from +1089 ms to +161 ms of LCP. The biggest were moving shared packages into the first chunk and registering remote entry URLs directly.

## How do I change the limits?

Override any of them in `mfeflow.json`. A remote can also set its own number in `mfe.json`.

```json title="mfeflow.json"
{
  "budget": { "shellKb": 40, "remoteKb": 15, "lcpDeltaMs": 400 }
}
```

Raising a limit is a decision. Write down why.

## Why these numbers?

They are targets chosen to keep a federated page close to a single app. They are not laws of nature. The point is that a miss becomes visible in CI instead of in a user's browser.

## Related

- Run the check: `pnpm mfeflow budget`, described in the [CLI reference](/reference/cli#budget).
- How the build is arranged: [How it works](/guide/how-it-works).
