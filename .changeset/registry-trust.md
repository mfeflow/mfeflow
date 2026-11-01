---
'@mfeflow/contracts': minor
'@mfeflow/core': minor
'mfeflow': minor
---

Third-party registries are now opt-in on your machine. `mfeflow features` no longer asks a registry that only appears in a cloned `mfeflow.json`; it says "not trusted yet" and tells you to run `mfeflow registry trust @namespace`. `registry add` trusts what it adds, `registry untrust` takes it back, and `MFEFLOW_TRUST_REGISTRIES=@a,@b` trusts namespaces for one CI run, for public addresses only; pin a template (`@a=https://…/{name}.json`) to allow a private one. The choice lives in `trusted-registries.json` in your user config folder, per namespace and exact URL template. Loopback and private addresses (localhost, 127/8, ::1, 10/8, 172.16/12, 192.168/16, 169.254/16, 100.64/10, fc00::/7 and more) are only requested from a trusted registry, and a redirect from a public address can never lead there (`MFEFLOW_E405`). An explicit `mfeflow add @ns/name` on a public https registry still works without trust; `add remote` and `add shell`, which fetch installed registry features again, need it.

`mfeflow add` records the sha256 of a registry feature's `feature.json` as `integrity` in `mfeflow.json`. When `add remote` or `add shell` fetch it again and the bytes differ, the command stops with `MFEFLOW_E406`; pass `--accept-changed-content` to take the new content on purpose. An index `version` that differs from the `feature.json` version is an error (`MFEFLOW_E402`).

The add plan lists the packages a registry feature brings under NEW PACKAGES, with a note that npm and yarn run install scripts and pnpm 10+ blocks them. Tokens in registry URLs (token, key, sig, auth, password, secret, X-Amz-*) are shown as `***` in `registry add/list`, `features` and error messages.

`@mfeflow/contracts` adds `isPrivateHost`, `redactUrl` and `redactUrlsIn`, and `integrity` on `mfeflow.json` features. `@mfeflow/core` adds the trust-file helpers, `checkIntegrity`, `integrityOf` and `indexedVersion`, and `fetchRemoteText`, `fetchFeatureIndex` and `getHttps` refuse private addresses unless told they are trusted.
