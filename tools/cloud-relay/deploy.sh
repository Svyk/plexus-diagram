#!/bin/sh
# Deploy the LlamaParse relay onto the Cloudflare account `wrangler login` already used.
# This script does not log in, does not create an account, and does not embed a key.
set -eu
cd "$(dirname "$0")"
echo "Deploying worker plexus-cloud-relay. Log in first with: npx wrangler login"
npx --yes wrangler deploy --name plexus-cloud-relay
echo "Paste the https://plexus-cloud-relay.<account>.workers.dev URL into Engines, or into DEFAULT_RELAY_URL in src/host/cloud-parse.js."
