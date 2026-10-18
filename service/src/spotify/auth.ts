// Spotify's Authorization Code flow with PKCE, and refreshing its tokens
// (identity.md). There is no client secret.
import { createHash, randomBytes } from "node:crypto";
import { discardBody, requiredBody } from "../http";
import type { TokenSource } from "./client";
import { tokenSchema, type TokenAnswer } from "./schemas";

// Only what the sync uses: read playlists and saved albums, save albums,
// and follow and make playlists, which the playlist-modify scopes cover.
export const scopes = [
  "playlist-read-private",
  "playlist-read-collaborative",
  "playlist-modify-private",
  "playlist-modify-public",
  "user-library-read",
  "user-library-modify",
] as const;

const base64url = (bytes: Buffer) => bytes.toString("base64url");

export function newLogin(): { state: string; verifier: string } {
  return {
    state: base64url(randomBytes(24)),
    verifier: base64url(randomBytes(64)),
  };
}

export function challengeOf(verifier: string): string {
  return base64url(createHash("sha256").update(verifier).digest());
}

export function authorizeUrl(config: {
  accountsBase: string;
  clientId: string;
  redirectUri: string;
  state: string;
  verifier: string;
}): string {
  const query = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    redirect_uri: config.redirectUri,
    code_challenge_method: "S256",
    code_challenge: challengeOf(config.verifier),
    scope: scopes.join(" "),
    state: config.state,
  });
  return `${config.accountsBase}/authorize?${query.toString()}`;
}

export class TokenRefused extends Error {
  override name = "TokenRefused";
  readonly status: number;
  constructor(status: number) {
    super(`Spotify's token service answered ${String(status)}.`);
    this.status = status;
  }
}

async function tokenRequest(
  accountsBase: string,
  form: Record<string, string>,
  send: typeof fetch,
): Promise<TokenAnswer> {
  const response = await send(`${accountsBase}/api/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form),
  });
  if (!response.ok) {
    await discardBody(response);
    throw new TokenRefused(response.status);
  }
  return requiredBody(response, tokenSchema, "Spotify's token service");
}

export function exchangeCode(config: {
  accountsBase: string;
  clientId: string;
  redirectUri: string;
  code: string;
  verifier: string;
  fetch?: typeof fetch;
}): Promise<TokenAnswer> {
  return tokenRequest(
    config.accountsBase,
    {
      grant_type: "authorization_code",
      code: config.code,
      redirect_uri: config.redirectUri,
      client_id: config.clientId,
      code_verifier: config.verifier,
    },
    config.fetch ?? fetch,
  );
}

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  // Milliseconds since the epoch.
  expiresAt: number;
}

export function storedTokens(
  answer: TokenAnswer,
  now: Date,
  previousRefresh?: string,
): StoredTokens | undefined {
  const refreshToken = answer.refresh_token ?? previousRefresh;
  if (refreshToken === undefined) return undefined;
  return {
    accessToken: answer.access_token,
    refreshToken,
    expiresAt: now.getTime() + answer.expires_in * 1000,
  };
}

// One person's tokens for one run. A refresh that brings a new refresh
// token is saved at once, since Spotify may stop taking the old one.
export function tokenSource(config: {
  accountsBase: string;
  clientId: string;
  initial: StoredTokens;
  save: (tokens: StoredTokens) => Promise<void>;
  now: () => Date;
  fetch?: typeof fetch;
}): TokenSource {
  let tokens = config.initial;
  let refreshing: Promise<string> | undefined;
  const refresh = () => {
    refreshing ??= tokenRequest(
      config.accountsBase,
      {
        grant_type: "refresh_token",
        refresh_token: tokens.refreshToken,
        client_id: config.clientId,
      },
      config.fetch ?? fetch,
    )
      .then(async (answer) => {
        const next = storedTokens(answer, config.now(), tokens.refreshToken);
        if (next === undefined) throw new TokenRefused(200);
        tokens = next;
        await config.save(next);
        return next.accessToken;
      })
      .finally(() => {
        refreshing = undefined;
      });
    return refreshing;
  };
  return {
    current: () =>
      tokens.expiresAt - 60_000 > config.now().getTime()
        ? Promise.resolve(tokens.accessToken)
        : refresh(),
    renew: refresh,
  };
}
