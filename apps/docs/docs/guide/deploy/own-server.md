---
title: Deploy to your own server
description: Serve the site folder from any static file server you already run, with an nginx example, an rsync upload order that keeps old versions, and a note on the registry server that is not built yet.
---

# Deploy to your own server

This how-to serves the site folder from a machine you run. Any server that sends static files works. It is one option in the [Deploy overview](/guide/deploy/).

You need a server with a web server on it, SSH access, and a `site-prod` folder from the overview's script. The nginx example is the one we checked; use your own server's equivalent.

## Check it on your laptop first

Before you upload anything, serve the folder locally. The `--single` flag sends unknown paths to `index.html`:

```sh
pnpm dlx serve --single site-prod
```

You should see a local address. Open it and click a remote route.

## Configure the web server

A server needs four rules. Remotes and hashed files are cached for a year. The index, the config and `index.html` are checked every time. Unknown app routes fall back to `index.html`. Unknown files under `/mfe/` are a real 404.

```nginx title="/etc/nginx/conf.d/shop.conf"
server {
  listen 80;
  server_name shop.example.com;
  root /var/www/shop;

  location /mfe/ {
    try_files $uri =404;
    add_header Cache-Control "public, max-age=31536000, immutable";
  }

  location /static/ {
    try_files $uri =404;
    add_header Cache-Control "public, max-age=31536000, immutable";
  }

  location = /config/runtime-config.json {
    add_header Cache-Control "no-cache" always;
  }

  location = /registry/index.json {
    add_header Cache-Control "no-cache" always;
  }

  location / {
    try_files $uri /index.html;
    add_header Cache-Control "no-cache" always;
  }
}
```

`add_header` is repeated in each location on purpose. nginx only inherits it from the level above when a location sets none of its own.

Test and reload:

```sh
sudo nginx -t
sudo systemctl reload nginx
```

You should see `syntax is ok` and `test is successful`. Add TLS with the tool you already use. The shell's index holds `https` addresses, so serve the site over HTTPS.

## Upload in the right order

Remote files go first, then the shell, then the two small files that decide what is live. If the index goes up before the files it points to, users get a broken page.

```sh
rsync -a site-prod/mfe/ deploy@shop.example.com:/var/www/shop/mfe/
rsync -a --exclude mfe --exclude config --exclude registry \
  site-prod/ deploy@shop.example.com:/var/www/shop/
rsync -a site-prod/config/ deploy@shop.example.com:/var/www/shop/config/
rsync -a site-prod/registry/ deploy@shop.example.com:/var/www/shop/registry/
```

Never use `--delete` on the `mfe` folder. Old versions have to stay for a rollback.

## Roll back

Keep a copy of each index you publish, such as `index-1.2.0.json` in a folder outside the web root. To roll back, copy the old one over the live file:

```sh
ssh deploy@shop.example.com \
  cp /var/www/backups/index-1.1.0.json /var/www/shop/registry/index.json
```

Users get the old version on their next page load. Nothing is rebuilt.

## The mfeflow registry server

A registry server is planned for Phase 05. It is not built, and this page will show it when it ships. Until then, a plain file server like the one above does the job.

If you want commands that upload and roll back for you, `mfeflow deploy` can write to a folder or an S3-compatible bucket. See [Deploy and roll back a remote](/guide/deploy-and-rollback).

## Next

- Compare hosts: [Deploy overview](/guide/deploy/).
