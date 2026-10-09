# Cloud relay

A Cloudflare Worker that lets Roam call LlamaParse. The LlamaParse API refuses browser calls from `https://roamresearch.com` and `app://roam` (preflight returns 400 `Disallowed CORS origin`). This worker adds those origins and forwards only the parse routes. It stores nothing and does not see a key of its own: the extension sends the user's LlamaParse key as `Authorization`, and the worker passes that header through.

This directory is not deployed. You choose who hosts it. Edit `tools/cloud-relay`. The build copies that directory here, because it replaces `deploy/` from scratch.

## What it forwards

| Method | Path | Upstream |
|---|---|---|
| POST | `/api/v1/beta/files` | file upload (`purpose=parse`) |
| POST | `/api/v2/parse` | start a job |
| GET | `/api/v2/parse/:id` | poll and fetch the result (`expand` query is passed through) |
| POST | `/api/v2/parse/:id/cancel` | cancel a running job |

Anything else is 404. `X-Pxd-Region: eu` selects `https://api.cloud.eu.llamaindex.ai`. Any other value, including a missing header, selects `https://api.cloud.llamaindex.ai`. The worker will not call a host you put in the URL.

Allowed browser origins are `https://roamresearch.com` and `app://roam`. A different `Origin` is 403 before the body is read. A request with no `Origin` (the helper, or `curl`) is forwarded.

Redirects are not followed. A presigned image or grounded-items URL on another host is not fetched here. Cell boxes from that sidecar need the local helper, which downloads it on this Mac and attaches `grounded_pages` to the JSON.

## Host it

From this directory, with a Cloudflare account you already have:

```sh
npx wrangler deploy
```

Put the worker's `https://…` URL in Engines, in the cloud sheet, as the relay URL. The extension uses the relay only when the local helper is not paired. Nothing in this repo deploys the worker, and there is no shared key to put in `wrangler.toml`.
