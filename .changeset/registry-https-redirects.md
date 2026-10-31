---
'@mfeflow/core': patch
'mfeflow': patch
---

Registry feature downloads follow redirects by hand like presets do, and refuse any redirect that leaves https before requesting it. `@mfeflow/core` exports `getHttps`, the walk both use.
