# @mfeflow/contracts

Part of [mfeflow](https://github.com/mfeflow/mfeflow), the React micro-frontend boilerplate and platform kit.

Types, validators and JSON Schemas for `mfeflow.app.json`, `mfeflow.json` and the remote registry. Pre-1.0: minor versions may change the API.

```sh
pnpm add @mfeflow/contracts
```

Check a file:

```ts
import { readFileSync } from 'node:fs';
import { validateMfeflowProject } from '@mfeflow/contracts';

const issues = validateMfeflowProject(JSON.parse(readFileSync('mfeflow.json', 'utf8')));
for (const { path, message } of issues) console.error(`${path || '(root)'}: ${message}`);
```

Each validator returns a list of issues, empty when the file is fine: `validateMfeManifest` (`mfeflow.app.json`), `validateMfeflowProject` (`mfeflow.json`), `validateRegistryEntry` and `validateRegistryIndex`. `JSON_SCHEMAS` holds the JSON Schema of each file, and `SCHEMA_URLS` where they are published for `$schema`.

`@mfeflow/contracts/entry` has the remote name, route and entry-type rules the registry checks use (`isRemoteName`, `ROUTE`, `EXPOSE`, `ENTRY_TYPES`, `registryRemoteIssues`). It imports nothing, so a shell can load it in the browser.

Bucket: **stateless**. Pure types and functions; no sharing config is needed.

Docs: [mfeflow.github.io/mfeflow](https://mfeflow.github.io/mfeflow/).

MIT licensed.
