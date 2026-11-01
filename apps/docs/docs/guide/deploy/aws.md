---
title: Deploy to AWS S3 and CloudFront
description: Host the site folder in a private S3 bucket behind CloudFront with origin access control, set cache headers per path with the AWS CLI, and handle SPA routes and roll back by index.
---

# Deploy to AWS S3 and CloudFront

This how-to hosts the site folder in a private S3 bucket and serves it through CloudFront. It is one option in the [Deploy overview](/guide/deploy/). Use it if your team already runs on AWS.

You need an AWS account, the AWS CLI, and a `site-prod` folder from the overview's script. Make one bucket and one CloudFront distribution per environment. The build is the same for all of them.

## Upload with the right headers

CloudFront follows the `Cache-Control` header your objects carry. When an object has none, the cache policy below applies a 24-hour default. So give every upload its header.

Versioned remote files and hashed shell files never change. Sync them once with a one-year header:

```sh
aws s3 sync site-prod/mfe s3://shop-prod/mfe \
  --cache-control "public, max-age=31536000, immutable"
aws s3 sync site-prod/static s3://shop-prod/static \
  --cache-control "public, max-age=31536000, immutable"
```

Do not add `--delete` to the `mfe` sync. Old versions must stay, or a rollback has nothing to go back to.

Now the files that decide what is live. Use `aws s3 cp`, not `sync`:

```sh
aws s3 cp site-prod/index.html s3://shop-prod/index.html \
  --cache-control "no-cache"
aws s3 cp site-prod/mf-manifest.json s3://shop-prod/mf-manifest.json \
  --cache-control "no-cache"
aws s3 cp site-prod/config/runtime-config.json s3://shop-prod/config/runtime-config.json \
  --cache-control "public, max-age=60" --content-type application/json
aws s3 cp site-prod/registry/index.json s3://shop-prod/registry/index.json \
  --cache-control "public, max-age=60" --content-type application/json
```

The AWS docs say `sync` uploads a file when its size differs, its time is newer, or it is missing. A file that did not change is skipped, so a new header never reaches it. A copy always uploads.

Upload the index last, after every file it points to.

## Give CloudFront access to the bucket

Keep the bucket private. Create a CloudFront origin access control (OAC) for S3, attach it to the origin, and allow only your distribution to read. Use the bucket policy from the AWS docs:

```json title="bucket-policy.json"
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowCloudFrontServicePrincipalReadOnly",
      "Effect": "Allow",
      "Principal": { "Service": "cloudfront.amazonaws.com" },
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::shop-prod/*",
      "Condition": {
        "StringEquals": {
          "AWS:SourceArn": "arn:aws:cloudfront::111122223333:distribution/EDFDVBD6EXAMPLE"
        }
      }
    }
  ]
}
```

Replace the account number and distribution id with yours. Apply it with `aws s3api put-bucket-policy --bucket shop-prod --policy file://bucket-policy.json`.

The OAC needs a regular S3 bucket origin, not the website endpoint. Sign requests, which is the default.

## Choose the cache policy

Attach the managed policy named CachingOptimized to the default behavior. It keeps each object between 1 second and 365 days and obeys the headers above. A file marked `no-cache` is still cached for the 1-second minimum.

If you prefer to write your own policy, keep the same idea: the origin's header decides.

## Make deep links work

The route `/catalog` is not a file in the bucket. Add two custom error responses on the distribution, one for 403 and one for 404. Each returns `/index.html` with response code 200.

Why both? Without the `s3:ListBucket` permission, S3 answers 403 Access Denied for a missing key, not 404. The OAC policy above only allows `GetObject`, so a missing file is a 403.

Two limits to know. Error responses apply to the whole distribution, so a missing file under `/mfe/` also returns the HTML page with status 200. And CloudFront caches errors for 10 seconds by default. Check the manifest URL with `curl -I` when a remote fails to load.

## Roll back

Rolling back is uploading the earlier `registry/index.json` again. Every old version is still under `mfe/`, so nothing else moves.

```sh
aws s3 cp previous/index.json s3://shop-prod/registry/index.json \
  --cache-control "public, max-age=60" --content-type application/json
```

Users see it within the 60-second cache time. To skip the wait, invalidate the path:

```sh
aws cloudfront create-invalidation --distribution-id EDFDVBD6EXAMPLE \
  --paths "/registry/index.json" "/config/runtime-config.json"
```

AWS recommends versioned file names over invalidation for frequent changes. That is what the versioned `mfe/<name>/<version>` folders give you. Use an invalidation only for the two small files that cannot be versioned.

## Use the mfeflow commands instead

This is optional. The deploy command can write straight to the bucket with `--host s3://shop-prod`. The promote and rollback commands move the index.

The files land under `<name>/<version>/`, with the index at `envs/<env>/index.json`. Point `registryUrls` at that index in the runtime config.

The commands need permission to list the bucket as well as read and write. Give the deploy user that, not CloudFront. Follow [Deploy and roll back a remote](/guide/deploy-and-rollback).

## Next

- Run it from CI: [One build, three platforms](/guide/deploy/multi-platform).
- Compare hosts: [Deploy overview](/guide/deploy/).
