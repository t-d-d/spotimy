# Repo and delivery
Relevance: Branch rules, CI, deploys, environments or repo layout: .github/workflows/**, infra/**, the gate command, repository settings
Decision: One repo on GitHub; main is protected and changes arrive by pull request; a green merge to main deploys to the one environment.

Why: Agents write most of the code and one person owns it, so the
gate on each pull request stands in for a second reviewer.

## Rules

- All code, the deployment definition and the docs live in this repo.
- The rules in force are in docs/constraints/. Decisions and their
  reasons live in issues.
- No direct pushes to main. Every change is a pull request.
- One command, npm run gate, runs the whole gate, locally and in CI.
- CI and deploys run on GitHub Actions, standard hosted runners only.
- A pull request merges only with the gate green.
- A green merge to main deploys. Nothing else deploys, except the same
  run putting back the last build that passed the live check, when the
  live check fails or the deploy fails once its stack deploy started.
- The tag live-ok names the last build that passed the live check.
- CI reaches AWS through GitHub's OIDC provider and the role in
  infra/github-oidc.cfn.yml, which only a job on main can assume. Its
  one stored secret is the Serverless Framework access key.
- The deploy checks the Serverless launcher and framework against
  pinned sums before running them.
- A change to a stored item's shape keeps the previous build able to
  read it, or its pull request says why it cannot.

## Do not

- Deploy from a laptop: what is live drifts from main.
- Add a second environment: every environment needs its own Spotify
  app and redirect address.
- Add a self-hosted runner: a public repo should not run pull request
  code on a personal machine.

History: Set when the repo was made, October 2026, following askme-mcp.
