---
title: Registry server SLOs
description: What the registry server promises about how fast a pointer move, a kill and the fallback reach people, with the measured number for each, the command that makes it, and what has not been measured yet.
---

# Registry server SLOs

This page lists what the registry server aims for, the number we measured for each, and what we have not measured. Every number has a command. Anything without one says so.

## The targets

| Target                                     | Aim                    | Measured                             | Where it comes from               |
| ------------------------------------------ | ---------------------- | ------------------------------------ | --------------------------------- |
| A rollback shows in a fresh index read     | under 10 s             | 2 ms median, 2 ms worst, local       | `node bench/registry-server.ts`   |
| A kill leaves the index                    | under 60 s             | 1 ms median, 2 ms worst, local       | `node bench/registry-server.ts`   |
| The static fallback follows a change       | no aim yet             | 2 ms median, 3 ms worst, to a folder | `node bench/registry-server.ts`   |
| A returning browser sees a change          | server number plus 5 s | not measured in a browser            | the index is `private, max-age=5` |
| Shells boot with the server down           | not stated             | not measured yet                     |                                   |
| Time for the gate to halt a bad rollout    | not stated             | not measured yet                     | depends on your traffic           |
| Load: requests per second the server holds | not stated             | not measured yet                     |                                   |

## How the numbers were made

Run the bench from a checkout:

```sh
pnpm install && pnpm build
node bench/registry-server.ts
```

You should see four lines of medians and a path under `bench/results/`. The file holds every run, the machine and the commit.

Each run deploys two versions, sends the request, and reads the index back to back until it shows the change. The clock starts just before the request is sent. The run above is 20 timed runs on an 8-core Apple laptop with Node 22. The server, its SQLite file, the artifact server and the fallback folder were all on that machine, so the numbers are a floor.

## What the pointer number means

The 2 ms is the server's own work: a database write and the next read. It has no network and no CDN in it. A real deployment adds the distance between the person and the server.

The index is served with a 5 second browser cache. A browser that already holds it can show the old version for up to 5 seconds more. That is why the aim for a returning browser is the server number plus 5 s, and why the 10 second aim still holds with room to spare.

## What a kill does and does not do

A kill removes the remote from the next index the server serves, and from the fallback it republishes. It does not reach into a page that has already loaded the remote. That page runs the remote until it reloads. The 60 second aim is for the index, not for open tabs.

## The fallback path

After every change the server rewrites the stable `index.json` on the fallback host. Shells list that file as their second index URL. If the server does not answer within 1.5 seconds, the shell reads the fallback instead.

We measured the write to a local folder. We have not measured a real bucket or a CDN in front of it. A static host adds its own cache time: the fallback file is served for up to 60 seconds, and GitHub Pages adds 10 minutes that cannot be changed.

We have not measured how long a shell takes to boot with the server down, in a browser. The 1.5 second wait is the code's default, covered by unit tests, not a measured boot time.

## What a rollout does not promise

The gate learns from browsers that report. With little traffic it may never reach a verdict, and a full reporter cap makes it stop learning. Read the counts with `mfeflow rollout status` rather than assuming it will catch a problem. It is a safety net, not a guarantee.

## Related

The steps for kills and recoveries are in [Run the registry server](/guide/deploy/registry-server-runbook). To choose between the static registry and the server, see [Deploy](/guide/deploy/).
