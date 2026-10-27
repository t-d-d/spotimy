# Working in this repo

spotimy keeps a small group's Spotify libraries in step: every album playlist becomes a saved album, every saved album gets a playlist, and the group follows each other's album playlists.

- [PRD.md](PRD.md) says what version 1 does and what it leaves out.
- [docs/constraints/](docs/constraints/README.md) holds the rules in force. Decisions and their reasons live in issues.

## Scope

- The PRD's "Out of scope" list is binding. Do not build a roadmap item.
- Work you find in passing becomes an issue. Do not fix it in the branch you are on. Weigh it when you raise it: close it then if its value does not pay for the complexity it adds.

## Before any code edit

- Run the `constraints` skill. Config, the deployment definition and `package.json` count as code.
- If the task conflicts with a constraint, stop and say so. Do not work around the rule, and do not quietly follow the task.
- A change to what a constraint means needs an issue the owner agrees to, linked from the file's History line.

## Tests first

- Write the failing test first. Watch it fail for the reason you expect, then write the code.
- A test's file name sets its tier ([test-tiers.md](docs/constraints/test-tiers.md)).

| Tier | File name | May touch |
| --- | --- | --- |
| Static | `*.static.ts` | The repo's own files, read only |
| Unit | `*.test.ts` | Memory only |
| Integration | `*.int.ts` | Loopback: the local database, the fake Spotify, the fake Parameter Store and Lambda |
| Browser | `*.browser.ts` | The built page in headless Chromium, with the API faked |
| Live | `*.live.ts` | The deployed site, reading only, never signed in |

- An assertion goes in the lowest tier that can see it.
- A fitness function's describe name starts `fitness:` and names its constraint file.
- Never weaken or delete a test to get the gate green.

## The gate

- `npm run gate` runs everything: format, lint, types, and the static, unit, integration and browser tests. It is the same command in CI.
- The gate is offline and holds no secrets. A test that needs the network or a key belongs to another tier.

## Branches and pull requests

- Never push to main. One branch per issue.
- Run the `pre-push` skill before every push. It ends by raising the pull request.
- The pull request body follows the `pr-description` skill.
- Nothing deploys except a green merge to main. Never deploy by hand.
- The owner merges. Do not merge your own pull request.

## Issues

- Given an issue number, run the `fetch-ticket` skill first.
- Labels are written with a space after the colon: `type: enhancement`, `type: nfr`, `type: chore`, `type: qa` or `type: bug`, and `mode: afk` or `mode: human`.
- Blockers are listed on a `Blocked by:` line at the top of the issue body. Do not start an issue whose blocker is open.
- An afk issue is picked up as soon as it has the label, and goes from its text to a pull request without stopping to ask.
- Anything only the owner can do is not yours: a dashboard setting, a secret, a Spotify account. Say what is needed and stop.
- When you stop with nobody watching, say why in a comment on the issue.
- Acceptance criteria are not yours to rewrite. If one cannot be met as written, say so under Drift in the pull request.
- When your pull request has merged or closed, or you are done and have none, make the last line of your reply `Signing off.` or `Signing off: <reason>`. That archives the session. Do not sign off while the owner is working with you.

## GitHub from a cloud session

- Read the `github-tooling` skill before any `gh` command. `gh issue` and `gh pr` fail in a cloud session.
- A session has no cloud credentials and cannot read the repo's secrets or variables. If a task needs a value, stop and say so.

## Spotify

- Only the documented Web API, under its February 2026 names ([spotify-api.md](docs/constraints/spotify-api.md)).
- A run only adds to a library, and never puts back what a person removed ([sync-safety.md](docs/constraints/sync-safety.md)).
- Never call the real Spotify from a test in the gate. test/fake-spotify.ts stands in for it.

## The page

- Before pushing a change to the page, open it at 390px wide in headless Chromium and look for anything cut off, wrapped or misaligned.
- Colours, sizes and spaces come from web/src/tokens.css. Do not add one anywhere else.

## Writing

- Plain words and whole sentences. No em dashes.
- Run the `unslop` skill over anything a person will read: pull request bodies, issues, docs, the README, text on the page.
