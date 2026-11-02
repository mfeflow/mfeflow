---
'mfeflow': patch
---

Registry server mode now takes the token out of everything it prints, not only the results. Error messages such as the rollback history, and the text of the confirm prompt, are scrubbed too, so a server that echoes the token back cannot leak it.
