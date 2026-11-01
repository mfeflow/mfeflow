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

The storefront example in the repository was measured with Lighthouse 13.6.0 on the mobile preset, with simulated throttling, median of 10 runs. The source is `examples/storefront/e2e/perf-summary.json`.

| Route    | LCP added | JS added (gzip) |
| -------- | --------- | --------------- |
| /catalog | +160 ms   | +46 KB          |
| /cart    | +133 ms   | +38 KB          |

LCP is inside the 300 ms limit on both routes. The JavaScript added is above the 32 KB shell limit. The example does not meet its own JavaScript budget in gzip. The same file shows brotli results, which are smaller: +40.1 KB for /catalog and +33 KB for /cart.

The file also records six steps that took the first route from +1089 ms to +161 ms. The biggest were moving shared packages into the first chunk and registering remote entry URLs directly.

## How do I change the limits?

Override any of them in `mfeflow.json`. A remote can also set its own number in `mfe.json`.

```json title="mfeflow.json"
{
  "budget": { "shellKb": 40, "remoteKb": 15, "lcpDeltaMs": 400 }
}
```

Raising a limit is a decision. Write down why.

## Why these numbers?

They are targets chosen to keep a federated page close to a single app. They are not laws of nature, and the storefront result shows a project can miss one. The point is that a miss becomes visible in CI instead of in a user's browser.

## Related

- Run the check: `pnpm mfeflow budget`, described in the [CLI reference](/reference/cli#budget).
- How the build is arranged: [How it works](/guide/how-it-works).
