---
'mfeflow': patch
---

`mfeflow add git-hooks` removes the `.git` it created when the install fails, so a rerun starts from the same state.
