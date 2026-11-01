# @mfeflow/registry

Part of [mfeflow](https://github.com/mfeflow/mfeflow), the React micro-frontend boilerplate and platform kit.

A registry for your remotes that lives on a static host. You build the next `index.json` from a remote's build output, check it against a few gates, and upload it. A rollback is the same upload with the previous version, no rebuild. Pre-1.0: minor versions may change the API.

```sh
pnpm add @mfeflow/registry
```

Nothing here is wired into a `mfeflow` command yet; the deploy and rollback commands come next. For now it is the library they will sit on.

## Build and gate an index

`@mfeflow/registry/static` has no IO in the builder, so it is easy to test and to run in CI.

```ts
import { localHost, planDeploy, applyPlan, readIndex } from '@mfeflow/registry/static';

const host = localHost('./site');
const { index, etag } = await readIndex(host, 'prod');

const plan = planDeploy({
  remote: mfeJson, // the remote's mfe.json
  version: '1.4.2+a1b2c3d',
  manifest: mfManifest, // its built mf-manifest.json
  files, // build output: path -> bytes
  env: 'prod',
  baseUrl: 'https://cdn.example.com',
  currentIndex: index,
  currentIndexEtag: etag,
  shellManifest, // the shell's deployed mf-manifest.json, optional
});

if (plan.failures.length > 0) throw new Error(plan.failures.map((f) => f.message).join('\n'));
await applyPlan(host, plan);
```

A deploy that fails a gate uploads nothing. The gates, by code:

| Code            | Fails when                                                                                                        |
| --------------- | ----------------------------------------------------------------------------------------------------------------- |
| `schema`        | the entry, the remote or the whole index is not valid, or `mf-manifest.json` is for another remote                |
| `route-overlap` | one of the remote's routes can match a URL that another remote's route matches                                    |
| `compat`        | a singleton range the remote asks for is not satisfied by the version the shell provides                          |
| `budget`        | the initial JS (gzip) is over `mfe.json` `budgets.initialJsKb`, or, without one, the entry is over the cost model |
| `rollout`       | a `rollout` is asked for; a static host cannot split traffic by percent                                           |

Shell versions come from the shell's `mf-manifest.json` `shared` entries, then from `workspaceVersions` for anything it does not list.

Each remote keeps `previous` and the last 10 versions in `history` (newest first), so a rollback knows where to go.

**Rollback.** Deploying a version that is already in `history` is a rollback. The remote then records the version it left in `rolledBackFrom`, and `previous` and `history` hold only versions older than the one you went back to. Rolling back again goes to the next older version and never returns to the bad one. Deploying a new version clears `rolledBackFrom`.

Warnings (`plan.warnings`) are checks that could not run, for example a shell version of `workspace:*` or a package the shell manifest lists with no version. They do not fail the deploy.

## What gets uploaded

- `<name>/<version>/...` with `Cache-Control: public, max-age=31536000, immutable`. A `+` in a version becomes `_` in keys and URLs.
- `envs/<env>/index.json` with `public, max-age=60` (set `indexCacheControl` to change it). That number is how long a rollback takes to reach users.
- Artifacts first, the index last. A file already published with the same size is skipped; one with a different size stops the deploy, because a version is immutable.

## Hosts

A host is `{ put, get, head, list? }`. The index is written with `If-Match` (or `If-None-Match: *` for the first one in an env), so two deploys cannot overwrite each other; the loser gets a `PreconditionFailedError` and reads the index again. `planDeploy` needs `currentIndexEtag` whenever you pass `currentIndex`. Artifacts are written create-only with their SHA-256 stored alongside, so a version can never be replaced with different content.

**A folder.** `localHost(dir)` writes files (to a temp file, then a rename, so a crash never leaves half a file) and refuses any key that leaves `dir`: `..`, absolute paths, drive letters, backslashes, `:` in a name, Windows device names, and symlinks that point outside.

**S3-compatible storage.** AWS S3, Cloudflare R2 and MinIO, signed with SigV4 on `node:crypto` and the global `fetch`. No SDK.

```ts
import { s3Host } from '@mfeflow/registry/s3';

const host = s3Host({
  endpoint: 'https://<account>.r2.cloudflarestorage.com', // omit for AWS
  region: 'auto',
  bucket: 'my-registry',
  accessKeyId: process.env.S3_KEY_ID,
  secretAccessKey: process.env.S3_SECRET,
});
```

A custom `endpoint` uses path-style URLs (`https://host/bucket/key`); set `forcePathStyle` to change either way. Errors never contain the keys or the session token.

The least a deploy needs on the bucket (scope `Resource` to the prefix you use):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject"],
      "Resource": "arn:aws:s3:::my-registry/*"
    },
    { "Effect": "Allow", "Action": "s3:ListBucket", "Resource": "arn:aws:s3:::my-registry" }
  ]
}
```

Without `s3:ListBucket`, S3 answers 403 instead of 404 for a key that does not exist. The host does not guess: it throws an `AccessDeniedError` that names the missing permission.

**GitHub Pages.** Not an adapter. Deploy into a folder with `localHost` and let a Pages workflow publish the folder. Pages caches every file for 10 minutes and you cannot change that, so a rollback there takes about 11 minutes. Use a bucket if that is too slow.

MIT licensed.
