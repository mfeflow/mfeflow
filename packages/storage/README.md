# @mfeflow/storage

Browser storage namespaced per micro-frontend. Keys are stored as `<mfe>:<key>`, so two remotes cannot overwrite each other. It falls back to memory when Web Storage is missing (SSR, sandboxed iframes), keeps tabs in sync and has a React hook.

## Install

```sh
pnpm add @mfeflow/storage
```

`react` (19) is an optional peer dependency, needed only for `@mfeflow/storage/react`.

## Usage

```ts
import { createStorage } from '@mfeflow/storage';

const storage = createStorage('cart'); // 'local' by default; { area: 'session' | 'memory' } also works
storage.set('items', ['a', 'b']);
const items = storage.get('items', [] as string[], Array.isArray);
const stop = storage.subscribe('items', (value) => console.log(value)); // this tab and other tabs
```

```tsx
import { useStoredState } from '@mfeflow/storage/react';

const [open, setOpen] = useStoredState(storage, 'drawer-open', false);
```

## Module Federation sharing

Bucket: **stateless**. Its listeners live on a page global, so separate copies in different remotes still see each other's writes and no copy is required to be the only one. `@mfeflow/rsbuild` shares it as a singleton by default anyway, which keeps one copy on the page; sharing is not required for correctness.

## Links

- [mfeflow repository](https://github.com/mfeflow/mfeflow) and its README
- [mfeflow.dev](https://mfeflow.dev) (documentation, coming soon)

MIT licensed.
