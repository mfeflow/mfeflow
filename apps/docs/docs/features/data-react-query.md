---
title: data-react-query - one shared cache for server data
description: Fetch server data with TanStack Query so the shell and every remote share one cache, with keys that cannot collide between remotes.
---

# data-react-query

This page shows how to fetch and cache server data across the shell and all remotes with TanStack Query. Because there is one cache for the page, a request made by one remote is not repeated by another.

## What you get

The shell owns the query client and its provider. Each remote gets a wrapper, a set of query keys prefixed with its own name, and an example query. This feature is off by default.

## Add it

```sh
pnpm mfeflow add data-react-query
```

What changed:

```text
apps/shell/src/query/
└── Query.tsx      # provider wrapped around the shell's App
apps/<remote>/src/query/
├── Query.tsx      # wrapper around each remote's exposed App
├── keys.ts        # query keys prefixed with the remote's name
└── useHealth.ts   # the example query
```

Tests for the shell and each remote are added when `testing` is installed. TanStack Query 5.105.0 is added to the shell and every remote.

## Use it

Call `useQuery` in a remote as you normally would, with a key from that remote's `queryKeys`:

```ts title="apps/cart/src/query/useHealth.ts"
export function useHealth() {
  return useQuery({
    queryKey: queryKeys.health(),
    queryFn: ({ signal }) => api.get('health', { signal }),
  });
}
```

That is the version generated when `http` is installed. Without it, the same file uses `fetch` against `/api/health` and throws on a non-OK response.

Keys start with the remote's name, so refreshing one remote's data leaves the others alone:

```ts title="apps/cart/src/query/keys.ts"
export const queryKeys = {
  all: ['cart'] as const,
  health: () => [...queryKeys.all, 'health'] as const,
};
```

```ts
queryClient.invalidateQueries({ queryKey: queryKeys.all });
```

## Configure it

There are no install options. The shell's client defaults are yours to change:

```ts title="apps/shell/src/query/Query.tsx"
export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } },
});
```

| Setting                | Default | Effect                                          |
| ---------------------- | ------- | ----------------------------------------------- |
| `staleTime`            | 30000   | Milliseconds before cached data counts as stale |
| `retry`                | 1       | Retries after a failed request                  |
| `refetchOnWindowFocus` | `false` | Refetch when the tab regains focus              |

## How it works

TanStack Query is a shared singleton, so the shell loads it once and every remote receives that copy. A remote finds the shell's client through React context, which gives you one cache and one set of in-flight requests whichever remote asks first.

The remote's `Query` wrapper checks for a client in context. Inside the shell it renders its children as they are. When you run `pnpm dev` inside a remote on its own, there is no shell, so the wrapper creates a client for that run.

## Gotchas

- Two copies of the library would mean two caches and a context that never matches. Doctor checks that the apps install the same version.

- Share data between remotes by reading the same key on purpose, and only for data the shell owns, such as the signed-in user. Put that key in the shell or the contracts package rather than copying the string.
- With `http`, a 4xx arrives as an `HttpError`. Use `retry` to skip retries for those.

```ts
retry: (count, error) => !(isHttpError(error) && error.status < 500) && count < 2,
```

## Reference

- [http](/features/http), whose client the example query uses
- [Shared singletons](/concepts/shared-singletons)
- [TanStack Query documentation](https://tanstack.com/query/latest)
