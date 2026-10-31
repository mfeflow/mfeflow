---
'@mfeflow/contracts': minor
---

Breaking (0.x): `assetsFromManifest` joins a `publicPath` like Module Federation's `getResourceUrl` (`${publicPath}${file}`), so a root-relative or relative `publicPath` now stays relative instead of resolving against the manifest URL; `auto` and empty still use the manifest's directory. With `metaData.getPublicPath` the URLs are computed in the browser, so the result has no `remoteEntry`, empty `exposes` and a `manifestOnly` reason: publish that remote by manifest URL. `RemoteAssets.remoteEntry` is now optional.
