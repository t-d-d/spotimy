# Setup

How to run spotimy's checks on a laptop. The accounts and settings a deployment needs are in [bootstrap.md](bootstrap.md).

## What you need

Node.js 22.18 or later (see [.node-version](../.node-version)) and Docker. The integration tests run DynamoDB Local in Docker, and the gate starts it.

## The gate

```
npm ci
npx playwright install chromium
npm run gate
```

`npm run gate` runs format, lint, types, and the static, unit, integration and browser tests. CI runs the same command. Nothing in it reaches past this machine: Spotify, Parameter Store and Lambda are faked on loopback.

## The live tier

After a deploy, CI runs `npm run test:live` against the deployed site. To run it by hand, set `SPOTIMY_URL` to the page's address.
