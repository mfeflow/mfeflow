---
'mfeflow': minor
'@mfeflow/core': minor
---

New command `mfeflow build`. It builds every remote, then the shell, through the bundler each app installed (Rsbuild by default, or Vite): remotes in parallel up to `--concurrency`, one process per app with the app's name in front of each output line, and a table at the end with each app's status, time and JS size (the number `budget` reads). The first failure stops new apps from starting and the command exits 5. `--only a,b` picks apps, inside an app's folder it builds that app, and `--json` prints one result document. The bundler is resolved from the app's own folder, never from the CLI. New errors: E308 (the bundler is not installed in an app, naming the package and the app), E309 (the app has no config file for its bundler) and E310 (an app did not build).
