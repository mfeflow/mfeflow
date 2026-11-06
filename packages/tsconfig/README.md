# @mfeflow/tsconfig

Strict TypeScript 7 presets used by every mfeflow project.

```sh
pnpm add -D @mfeflow/tsconfig typescript
```

`typescript` (>=7.0.0) is a peer dependency.

```json
{ "extends": "@mfeflow/tsconfig/react-app.json", "include": ["src"] }
```

| Preset               | For                                       |
| -------------------- | ----------------------------------------- |
| `base.json`          | shared strict options                     |
| `react-app.json`     | shells and remotes (DOM, JSX, no emit)    |
| `react-library.json` | publishable React packages (declarations) |
| `node.json`          | scripts and config files                  |

MIT licensed.
