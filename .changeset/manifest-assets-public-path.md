---
'@mfeflow/contracts': minor
---

Breaking (0.x): `assetsFromManifest` joins a `publicPath` like Module Federation's `getResourceUrl` (`${publicPath}${file}`). A relative or root-relative `publicPath` resolves against the shell page, so pass `{ pageUrl }` as the third argument; without it the remote comes back manifest-only with a reason. `auto` and empty still use the manifest's directory. With `metaData.getPublicPath` the URLs are computed in the browser, so the result has no `remoteEntry`, empty `exposes` and a `manifestOnly` reason: publish that remote by manifest URL. Every URL returned is absolute, so the output always passes the registry validators. `RemoteAssets.remoteEntry` is now optional.
