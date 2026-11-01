# data-react-query

Server state with TanStack Query, one cache for the whole page. Off by default.

```sh
pnpm mfeflow add data-react-query
```

## What you get

| File                                   | What it is for                                                                                             |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `apps/shell/src/query/Query.tsx`       | The `QueryClient` and its provider, around the shell. Defaults (`staleTime`, `retry`) are yours to change. |
| `apps/<remote>/src/query/Query.tsx`    | Wraps the remote's `App`. Inside the shell it does nothing; on its own it provides a client.               |
| `apps/<remote>/src/query/keys.ts`      | `queryKeys`: every key starts with the remote's name.                                                      |
| `apps/<remote>/src/query/useHealth.ts` | An example `useQuery`. With `http` it calls the app's `api` client; without it, `fetch`.                   |

## One client, because the package is a singleton

`@tanstack/react-query` is in the list of shared singletons, so the shell loads it once and every remote gets that
copy. The remote finds the shell's `QueryClient` through context: the same cache, the same in-flight requests and
the same deduplication, whichever remote asked first. `mfeflow doctor` fails if the apps install different versions
(check `singletons.versions`), because two copies would mean two caches and a context that never matches.

## Keys

A cache shared by independently deployed apps needs keys that cannot meet. Start every key with the remote's name
(`queryKeys.all` is `['cart']`), and refresh one remote's data without touching another's:

```ts
queryClient.invalidateQueries({ queryKey: queryKeys.all });
```

Share data between remotes by reading the same key on purpose, and only for data the shell owns (the signed-in
user, say). Put that key in the shell or the contracts package rather than copying the string.

## With `http`

The example passes the query's `signal` to `api.get`, so leaving the page cancels the request. A 4xx is an
`HttpError`; set `retry` to skip retries for those:

```ts
retry: (count, error) => !(isHttpError(error) && error.status < 500) && count < 2,
```

## Cost

The shell pays for the library once; a remote adds only its wrapper (a few hundred bytes). If the first load is tight,
load the provider with the first screen that needs data instead of at boot.

## Standalone remotes

`pnpm dev` inside a remote runs it with no shell. `Query.tsx` provides a client of its own then, so `useQuery` works there too.
