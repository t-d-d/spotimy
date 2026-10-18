import { describe, expect, it } from "vitest";
import {
  authorizeUrl,
  challengeOf,
  scopes,
  storedTokens,
  tokenSource,
  type StoredTokens,
} from "./auth";

describe("sign-in", () => {
  // The challenge is the verifier's SHA-256, in base64url without padding
  // (RFC 7636). Web Crypto works it out independently.
  async function expected(verifier: string): Promise<string> {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(verifier),
    );
    return Buffer.from(digest).toString("base64url");
  }

  it("makes the challenge PKCE asks for", async () => {
    const verifier = "dBjftJeZ4CVP-mJ92K9mUrB3l4XhnPGkiFPVUf8Aqt8";
    expect(challengeOf(verifier)).toBe(await expected(verifier));
    expect(challengeOf(verifier)).not.toContain("=");
  });

  it("asks Spotify for a code, with the challenge and only the scopes the sync uses", async () => {
    const url = new URL(
      authorizeUrl({
        accountsBase: "https://accounts.spotify.com",
        clientId: "abc123def",
        redirectUri: "https://d1.cloudfront.net/api/callback",
        state: "state123",
        verifier: "dBjftJeZ4CVP-mJ92K9mUrB3l4XhnPGkiFPVUf8Aqt8",
      }),
    );
    expect(url.origin + url.pathname).toBe(
      "https://accounts.spotify.com/authorize",
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "abc123def",
      response_type: "code",
      redirect_uri: "https://d1.cloudfront.net/api/callback",
      code_challenge_method: "S256",
      code_challenge: await expected(
        "dBjftJeZ4CVP-mJ92K9mUrB3l4XhnPGkiFPVUf8Aqt8",
      ),
      scope: scopes.join(" "),
      state: "state123",
    });
  });

  it("keeps the old refresh token when a refresh brings none", () => {
    const now = new Date("2026-10-18T12:00:00Z");
    expect(
      storedTokens({ access_token: "a", expires_in: 3600 }, now, "r-old"),
    ).toEqual({
      accessToken: "a",
      refreshToken: "r-old",
      expiresAt: now.getTime() + 3_600_000,
    });
    expect(
      storedTokens({ access_token: "a", expires_in: 3600 }, now),
    ).toBeUndefined();
  });
});

describe("a person's tokens during a run", () => {
  const now = new Date("2026-10-18T12:00:00Z");
  const expired: StoredTokens = {
    accessToken: "old",
    refreshToken: "r1",
    expiresAt: now.getTime() - 1,
  };

  function source(answer: () => Response) {
    const saved: StoredTokens[] = [];
    const forms: string[] = [];
    const tokens = tokenSource({
      accountsBase: "https://accounts.spotify.com",
      clientId: "abc123def",
      initial: expired,
      save: (next) => {
        saved.push(next);
        return Promise.resolve();
      },
      now: () => now,
      fetch: (_url: RequestInfo | URL, init?: RequestInit) => {
        forms.push(
          init?.body instanceof URLSearchParams ? init.body.toString() : "",
        );
        return Promise.resolve(answer());
      },
    });
    return { tokens, saved, forms };
  }

  it("refreshes an expired token, and saves a new refresh token at once", async () => {
    const { tokens, saved, forms } = source(() =>
      Response.json({
        access_token: "new",
        refresh_token: "r2",
        expires_in: 3600,
      }),
    );
    expect(await tokens.current()).toBe("new");
    expect(saved).toEqual([
      {
        accessToken: "new",
        refreshToken: "r2",
        expiresAt: now.getTime() + 3_600_000,
      },
    ]);
    expect(new URLSearchParams(forms[0]).get("refresh_token")).toBe("r1");
    expect(await tokens.current()).toBe("new");
    expect(forms).toHaveLength(1);
  });

  it("fails when Spotify refuses the refresh", async () => {
    const { tokens } = source(() =>
      Response.json({ error: "invalid_grant" }, { status: 400 }),
    );
    await expect(tokens.current()).rejects.toMatchObject({
      name: "TokenRefused",
      status: 400,
    });
  });
});
