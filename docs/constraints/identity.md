# Identity
Relevance: Sign-in, sessions, cookies, Spotify tokens or who may use spotimy: service/src/session.ts, service/src/spotify/auth.ts, service/src/api.ts, serverless.yml
Decision: People sign in with Spotify; the service keeps their tokens server side and gives the page only a signed session cookie.

Why: spotimy acts on people's Spotify libraries every day, unattended,
so it must hold refresh tokens. Those never leave the service.

## Rules

- Sign-in is Spotify's Authorization Code flow with PKCE. There is no
  client secret.
- Spotify's own allowlist decides who can sign in: an app in
  development mode admits only the accounts listed under User
  Management, at most five. Whoever signs in joins the group.
- The redirect address is PUBLIC_URL followed by /api/callback, and
  nothing else.
- The PKCE verifier and the state travel in a short-lived signed
  cookie, __Host-login, and the callback checks the state.
- The session is a signed cookie, __Host-session: HttpOnly, Secure,
  SameSite=Lax, Path=/. It holds the user id and an expiry, nothing
  else.
- The signing key is the SecureString /spotimy/session-key, read at
  run time.
- Every request that changes anything must carry an Origin header equal
  to PUBLIC_URL.
- Spotify tokens are stored only in the person's TOKEN item, and never
  sent to the page or logged.
- A refreshed token that comes with a new refresh token replaces the
  old one at once.

## Do not

- Put tokens in local storage or any cookie: the page never needs them.
- Ask for scopes the sync does not use.
- Add an allowlist of our own: Spotify's already admits only the
  accounts the owner lists.

History: Set when the repo was made, October 2026.
