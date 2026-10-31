---
'@mfeflow/rsbuild': patch
---

The Module Federation ESM runtime swap takes the twin's path literally, so a path containing `$&` or `$1` no longer corrupts the module request.
