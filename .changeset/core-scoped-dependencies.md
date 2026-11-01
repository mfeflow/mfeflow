---
'@mfeflow/core': minor
---

Features that ship with mfeflow can name a dependency in the project's scope (`{{scope}}/contracts`), fill `{{app.name}}` into a file destination, and write a file relative to the project root with `atRoot`. Third-party features are refused all three (E203).
