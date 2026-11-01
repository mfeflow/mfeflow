---
'@mfeflow/analytics': patch
---

`page_view` carries the query string (personal data and secrets removed; `utm_*`, `gclid` and `fbclid` kept) in `page_path` and `page_location`, follows hash routers, and is deduplicated on path and query. The GTM provider reads `page_title` after the route has rendered instead of at the moment of navigation.
