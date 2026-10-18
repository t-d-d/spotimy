# spotimy

Keeps a small group's Spotify libraries in step. Every playlist that is a whole album gets its album saved, every saved album gets a playlist, and the group follows each other's album playlists.

Built by [Thomas Dickinson](https://github.com/t-d-d) with Claude, on the same footing as [askme-mcp](https://github.com/t-d-d/askme-mcp).

## Why

Before Spotify let you save albums, the way to keep one was a playlist. Thomas and his brother each have years of them, one per album, named "Artist – Album" and filed in a folder per year, and each follows the other's. Saving an album is now quicker, but the year folders only hold playlists. spotimy keeps both views of the same set.

## How a run works

1. **Read.** Each member's playlists and saved albums, with their own Spotify token.
2. **Identify.** What each playlist is. A member's own playlist is read track by track. A playlist from outside the group, whose tracks Spotify hides from apps, is matched by its name, then confirmed by its cover art: a playlist of one album shows that album's own cover. Each answer is cached by the playlist's snapshot, so an unchanged playlist is never read twice.
3. **Plan.** For each person: albums to save, the group's album playlists to follow, and playlists to make for saved albums that have none.
4. **Apply.** When the person presses Apply, or each morning if they turned that on. A first plan always waits.

A run only adds. It never removes, unfollows or unsaves anything, and it never puts back what someone removed ([sync-safety.md](docs/constraints/sync-safety.md)).

Spotify's Web API has no access to playlist folders, so new and followed playlists land at the top of the library. The page lists them by year, and each person drags them into place.

## Stack

| Part | Choice |
| --- | --- |
| Page | React and TypeScript, built with Vite, served from S3 through CloudFront |
| API | TypeScript on Lambda behind API Gateway, on the page's own address |
| Worker | One Lambda, run daily by EventBridge and on request, carrying on in a fresh invocation when a run is long |
| Store | One DynamoDB table, on demand |
| Sign-in | Spotify's Authorization Code flow with PKCE, and a signed session cookie |
| Logs and alerts | CloudWatch, with three alarms that email the owner |
| Delivery | GitHub Actions. A green merge to main deploys, and a failed live check puts back the last good build |
| Tests | Vitest, Playwright as a library, DynamoDB Local in Docker, and a loopback fake of Spotify |

The rules each part is held to are in [docs/constraints/](docs/constraints/README.md).

## How it is tested

`npm run gate` runs format, lint, types, and four tiers of tests. It runs offline, holds no secrets, and is the same command on a laptop and in CI.

| Tier | What it checks |
| --- | --- |
| Static | Fitness functions that read the repo: routes, the table, alarms, tiers, the constraint files |
| Unit | The planner, names and covers, sessions, the Spotify client's retries, the page's wording |
| Integration | Whole runs and the API end to end, against DynamoDB Local and a fake Spotify that behaves like a development-mode app since February 2026 |
| Browser | The built page in headless Chromium, with the API faked |
| Live | The deployed site, after each deploy, read only |

## Limits

- Five people at most: Spotify's development mode admits no more.
- Spotify's rate limit is shared by every app its owner has. A run that Spotify asks to wait a long time stops there. What it found is kept, so the next run, the morning's or one someone starts, picks up from it.
- Spotify's sign-in has no test mode, so the live check after a deploy never signs in.

## Setup

[docs/bootstrap.md](docs/bootstrap.md) lists the accounts and settings a deployment needs. [docs/setup.md](docs/setup.md) says how to run the gate on a laptop.

## Licence

[Apache 2.0](LICENSE).
