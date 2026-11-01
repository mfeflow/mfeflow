---
'@mfeflow/core': minor
---

New `detectFederation(dir)` works out the Module Federation setup of an existing project that was not made with mfeflow. It reads `rsbuild.config.*` with `pluginModuleFederation`, `module-federation.config.*` with `createModuleFederationConfig`, and rspack or webpack configs with `ModuleFederationPlugin`. For each app it finds (the folder itself, or each package in a pnpm or npm workspace) it returns the name, whether it is a shell or a remote, the build tool, the config file, its remotes, exposes, shared packages and dev port.

Config files are parsed as source and never imported or run. Only values written out in the file count. Anything else, like a function call, an env variable or a spread of an imported object, is listed in `notAdopted` with the reason, so nothing is guessed. This is the first step of the upcoming `mfeflow adopt` command.
