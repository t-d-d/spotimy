# Test tiers
Relevance: Adding or moving a test, a fake or a test script, or editing what runs one: **/*.static.ts, **/*.test.ts, **/*.int.ts, **/*.browser.ts, **/*.live.ts, test/**, the gate command, .github/workflows/**
Decision: Five tiers kept apart by file suffix; static, unit, integration and browser form an offline, secret-free gate; live runs after each deploy.

Why: The gate is the reviewer, so it must run the same on a laptop and
a standard runner, and never touch a real Spotify account.

## Rules

- A test's suffix fixes its tier: .static.ts static, .test.ts unit,
  .int.ts integration, .browser.ts browser, .live.ts live.
- Static reads the repo's own files. Unit touches memory only.
  Integration touches loopback only. Browser opens the built page in
  headless Chromium with the API faked. Live reads the deployed site.
- The gate reaches loopback only and holds no secrets. test/offline.ts
  refuses anything else.
- Integration tests use a real DynamoDB run locally in Docker.
- Spotify is faked at the HTTP edge by test/fake-spotify.ts, a loopback
  server for both the Web API and the accounts service. The service's
  real client and sign-in code talk to it.
- One runner for the repo. Playwright is used as a library.
- The live tier only reads, and never signs in: Spotify's sign-in has
  no test mode.
- An assertion goes in the lowest tier that can see it.

## Do not

- Replace the local DynamoDB with an in-memory fake: conditional writes
  are the real store's behaviour.
- Call the real Spotify from the gate.
- Widen a tier's pattern to bare *.ts.
- Add a second test runner.

History: Set when the repo was made, October 2026, following askme-mcp.
