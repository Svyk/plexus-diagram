# Cloud relay

A Cloudflare Worker that lets Roam call LlamaParse. LlamaParse refuses browser calls from `https://roamresearch.com` (preflight returns 400 `Disallowed CORS origin`). This worker adds the Roam origins and forwards only the parse routes.

It stores nothing. It has no key of its own. It does not log headers or bodies. The extension sends the user's LlamaParse key as `Authorization`, and the worker copies that header through unchanged. `Cookie` is not forwarded. `Set-Cookie` from upstream is dropped.

This directory is not deployed. `npm run relay:deploy` deploys it onto the Cloudflare account you log into. The build copies this directory to `deploy/cloud-relay` because the build replaces `deploy/` from scratch.

## What it forwards

| Method | Path | Upstream |
|---|---|---|
| POST | `/api/v1/beta/files` | file upload (`purpose=parse`) |
| POST | `/api/v2/parse` | start a job |
| GET | `/api/v2/parse/:id` | poll and fetch the result (`expand` query is passed through) |
| POST | `/api/v2/parse/:id/cancel` | cancel a running job |

Anything else is 404. `X-Pxd-Region: eu` selects `https://api.cloud.eu.llamaindex.ai`. Any other value, including a missing header, selects `https://api.cloud.llamaindex.ai`. The worker will not call a host you put in the URL.

A declared body over 100 MB is 413 and is not forwarded. That is the Cloudflare Free account plan's request-body limit (413 from Cloudflare itself if a larger body arrives). A body with no `Content-Length` is read only until 100 MB, then refused.

Redirects are not followed. A presigned image or grounded-items URL on another host is not fetched here. Cell boxes from that sidecar need the local helper, which downloads it on this Mac and attaches `grounded_pages` to the JSON.

## Who may call it

Allowed browser origins are `https://roamresearch.com` and `app://roam`. A different `Origin` is 403 before the body is read. `OPTIONS` is 204 with `Vary: Origin`.

Roam in the browser is `https://roamresearch.com`. Roam Research.app 0.0.39 on this Mac loads that same URL (`loadURL` of `https://roamresearch.com/?server-port=…` in `Contents/Resources/app.asar`). The bundle contains no `app://` string, so the desktop page origin is the web origin. `app://roam` stays on the allowlist so a shell that does send it is not refused.

A request with no `Origin` (curl, or another server) is forwarded. That is the whole threat model: the worker is an open proxy to those four LlamaParse routes and nothing else. The caller can reach only LlamaParse, and only with the key they put in `Authorization`. The worker cannot list, read, or spend anyone else's files, because it never adds a key and it never stores one.

## Free tier

From [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/) (page last updated 2026-10-08) and [pricing](https://developers.cloudflare.com/workers/platform/pricing/), read 2026-10-09:

| Limit | Workers Free |
|---|---|
| Requests | 100,000 per day, reset at midnight UTC. Past that, error 1027. |
| CPU time | 10 ms per HTTP request. Waiting on `fetch` does not count. Past that, error 1102. |
| Memory | 128 MB per isolate. |
| Subrequests | 50 per request. This worker makes one. |
| Request body | 100 MB on the Free account plan (the account plan, not the Workers plan). Over that, 413. |
| HTTP duration | No limit while the client stays connected. |

One parse is an upload, a start, a poll every few seconds, and a result fetch. A long job spends many of the 100,000 daily requests. The worker does not parse the PDF, so the 10 ms CPU budget is header copying, not the file.

## Deploy

You need a Cloudflare account and Wrangler logged into it. This repo does not log in and does not deploy for you.

```sh
npx wrangler login
npm run relay:deploy
```

`npm run relay:deploy` runs `tools/cloud-relay/deploy.sh`, which runs `wrangler deploy --name plexus-cloud-relay` and prints the `https://plexus-cloud-relay.<account>.workers.dev` URL.

Then either:

- paste that URL into Engines, in the cloud sheet, as the relay URL, or
- set `DEFAULT_RELAY_URL` in `src/host/cloud-parse.js` to that URL and ship the extension.

The extension uses a route in this order: a paired local helper whose health lists the `cloud` engine, then the relay URL saved in Engines, then `DEFAULT_RELAY_URL`, then a sentence that says what is missing. `DEFAULT_RELAY_URL` starts empty. Nothing in this repo puts a shared LlamaParse key in `wrangler.toml`.
