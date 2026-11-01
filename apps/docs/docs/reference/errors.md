---
title: Error codes
description: The list of every numbered mfeflow error, grouped by area with its exit code, a short title and a link to the page that explains the cause and the fix.
---

# Error codes

Every error the CLI prints has a code like MFEFLOW_E102, a cause, a fix and a link to a page. This page lists them all. The first digit is the area, and it sets the exit code. Messages that start with MFE_ come from the browser runtime. Those are covered in [Troubleshooting](/guide/troubleshooting).

## Project and config (E1xx, exit code 3)

| Code                 | Meaning                                                                           |
| -------------------- | --------------------------------------------------------------------------------- |
| [E101](/errors/E101) | A shared singleton is missing from the shared list                                |
| [E102](/errors/E102) | No mfeflow.json found                                                             |
| [E103](/errors/E103) | mfeflow.json is not valid JSON                                                    |
| [E104](/errors/E104) | mfeflow.json does not match its schema                                            |
| [E105](/errors/E105) | A path points outside the project                                                 |
| [E106](/errors/E106) | A file could not be read or written                                               |
| [E107](/errors/E107) | A command-line option is missing or not valid                                     |
| [E108](/errors/E108) | The target folder is not empty                                                    |
| [E109](/errors/E109) | The preset could not be used                                                      |
| [E110](/errors/E110) | --local does not point at a built mfeflow checkout                                |
| [E111](/errors/E111) | A workspace package has no version                                                |
| [E112](/errors/E112) | An app in mfeflow.json is not on disk                                             |
| [E113](/errors/E113) | mfe.json is missing or invalid                                                    |
| [E114](/errors/E114) | A registry entry is missing or invalid                                            |
| [E115](/errors/E115) | Two apps use the same port                                                        |
| [E116](/errors/E116) | Two remotes claim routes that overlap, or an mfe.json disagrees with mfeflow.json |
| [E117](/errors/E117) | A copied file changed since mfeflow wrote it                                      |
| [E118](/errors/E118) | .env.example does not match the keys in env.ts                                    |
| [E119](/errors/E119) | A runtime-config file does not match the runtime-config schema                    |
| [E120](/errors/E120) | A PUBLIC_ variable would be baked into the bundle                                 |
| [E121](/errors/E121) | A server env key is not listed in turbo.json                                      |

## Features (E2xx, exit code 4)

| Code                 | Meaning                                                             |
| -------------------- | ------------------------------------------------------------------- |
| [E201](/errors/E201) | Feature not found                                                   |
| [E202](/errors/E202) | feature.json is invalid                                             |
| [E203](/errors/E203) | A third-party feature uses something third-party features may not   |
| [E204](/errors/E204) | Unknown transform op                                                |
| [E205](/errors/E205) | Feature conflicts with an installed feature                         |
| [E206](/errors/E206) | Feature needs another feature first                                 |
| [E207](/errors/E207) | The feature wants to create or change something that already exists |
| [E208](/errors/E208) | A file the feature edits is missing or not shaped as expected       |
| [E209](/errors/E209) | A template could not be rendered                                    |
| [E210](/errors/E210) | Registry namespace is not configured                                |
| [E211](/errors/E211) | Files changed since the plan was made                               |
| [E212](/errors/E212) | Applying the plan failed                                            |
| [E213](/errors/E213) | Installing dependencies failed                                      |
| [E214](/errors/E214) | A feature option is invalid                                         |
| [E215](/errors/E215) | The app name cannot be used                                         |

## Build and runtime (E3xx, exit code 5)

| Code                 | Meaning                                       |
| -------------------- | --------------------------------------------- |
| [E301](/errors/E301) | A singleton resolves to more than one version |
| [E302](/errors/E302) | A remote is not compatible with its shell     |
| [E303](/errors/E303) | A runtime plugin imports a shared module      |
| [E304](/errors/E304) | A bundle is over its budget                   |
| [E305](/errors/E305) | There is no build output to measure           |
| [E306](/errors/E306) | A dev server could not start                  |

## Registry (E4xx, exit code 6)

| Code                 | Meaning                                               |
| -------------------- | ----------------------------------------------------- |
| [E401](/errors/E401) | Could not fetch from the registry                     |
| [E402](/errors/E402) | The registry returned something that is not a feature |
| [E403](/errors/E403) | The registry's index.json is not valid                |
| [E404](/errors/E404) | A feature in the registry folder cannot be published  |

E107 and E215 are command-line mistakes and exit with code 2. Codes in the E5xx range are reserved for the upgrade command and exit with code 7. None are used in this release.
