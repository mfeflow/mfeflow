---
'@mfeflow/rsbuild': patch
---

The `eager: false` async-boundary check reads the entry with `es-module-lexer` instead of a hand-written tokenizer. It accepts any dynamic `import()` of a relative module, including a template literal without expressions, and ignores `import()` in comments, strings and type positions.
