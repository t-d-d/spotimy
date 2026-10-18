import { describe, expect, it } from "vitest";
import { readEnv } from "./env";

const good = {
  PUBLIC_URL: "https://d111.cloudfront.net",
  TABLE_NAME: "spotimy",
  SPOTIFY_CLIENT_ID: "abcdef0123456789",
  SESSION_KEY_PARAMETER: "/spotimy/session-key",
  WORKER_FUNCTION: "spotimy-prod-worker",
};

describe("the environment", () => {
  it("reads what production sets, with Spotify's real addresses", () => {
    const env = readEnv(good);
    expect(env.publicUrl).toBe("https://d111.cloudfront.net");
    expect(env.spotifyApiBase).toBe("https://api.spotify.com/v1");
    expect(env.spotifyAccountsBase).toBe("https://accounts.spotify.com");
  });

  it("refuses a public address that is plain http, or has a path", () => {
    expect(() =>
      readEnv({ ...good, PUBLIC_URL: "http://d111.cloudfront.net" }),
    ).toThrow(/https/u);
    expect(() =>
      readEnv({ ...good, PUBLIC_URL: "https://d111.cloudfront.net/x" }),
    ).toThrow(/origin/u);
  });

  it("lets stand-ins in only on this machine", () => {
    expect(
      readEnv({ ...good, SPOTIFY_API_BASE: "http://127.0.0.1:9/v1" })
        .spotifyApiBase,
    ).toBe("http://127.0.0.1:9/v1");
    expect(() =>
      readEnv({ ...good, SPOTIFY_API_BASE: "https://evil.example/v1" }),
    ).toThrow(/this machine/u);
  });

  it("says what is missing", () => {
    expect(() => readEnv({})).toThrow(/TABLE_NAME/u);
  });
});
