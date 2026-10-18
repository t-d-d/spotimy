import { describe, expect, it } from "vitest";
import { z } from "zod";
import { silentLogger } from "../log";
import { createSpotifyClient, RateLimited, SpotifyError } from "./client";

const apiBase = "https://api.spotify.com/v1";

interface Sent {
  url: string;
  token: string | null;
}

// A fetch that answers from a list, and records what it was sent.
function scripted(answers: (() => Response)[]) {
  const sent: Sent[] = [];
  const send = (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const headers = new Headers(init?.headers);
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    sent.push({ url, token: headers.get("authorization") });
    const next = answers.shift();
    if (next === undefined) throw new Error("No answer left.");
    return Promise.resolve(next());
  };
  return { sent, send };
}

function client(send: typeof fetch, renewed: string[] = []) {
  const waits: number[] = [];
  let token = "first";
  return {
    waits,
    spotify: createSpotifyClient({
      apiBase,
      log: silentLogger,
      fetch: send,
      gapMs: 0,
      sleep: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
      tokens: {
        current: () => Promise.resolve(token),
        renew: () => {
          token = "second";
          renewed.push(token);
          return Promise.resolve(token);
        },
      },
    }),
  };
}

const ok = (body: unknown) => () => Response.json(body);
const status =
  (code: number, headers: Record<string, string> = {}) =>
  () =>
    new Response("{}", { status: code, headers });
const meSchema = z.object({ id: z.string() });

describe("the Spotify client", () => {
  it("waits as long as Retry-After asks when that is short, then tries again", async () => {
    const { send } = scripted([
      status(429, { "retry-after": "3" }),
      ok({ id: "thomas" }),
    ]);
    const { spotify, waits } = client(send);
    expect(await spotify.get("/me", meSchema)).toEqual({ id: "thomas" });
    expect(waits).toContain(4000);
  });

  it("gives up on a long Retry-After, so the run can pause", async () => {
    const { send } = scripted([status(429, { "retry-after": "3600" })]);
    const { spotify } = client(send);
    const failure = await spotify
      .get("/me", meSchema)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(RateLimited);
    expect(failure).toMatchObject({ retryAfter: 3600 });
  });

  it("renews the token once after a 401", async () => {
    const renewed: string[] = [];
    const { send, sent } = scripted([status(401), ok({ id: "thomas" })]);
    const { spotify } = client(send, renewed);
    await spotify.get("/me", meSchema);
    expect(renewed).toEqual(["second"]);
    expect(sent.map((each) => each.token)).toEqual([
      "Bearer first",
      "Bearer second",
    ]);
  });

  it("fails on a second 401, and on a refusal", async () => {
    const twice = scripted([status(401), status(401)]);
    await expect(
      client(twice.send).spotify.get("/me", meSchema),
    ).rejects.toBeInstanceOf(SpotifyError);
    const refused = scripted([status(403)]);
    await expect(
      client(refused.send).spotify.get("/me", meSchema),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("follows next links through every page", async () => {
    const { send, sent } = scripted([
      ok({
        items: [{ id: "a" }, null],
        next: `${apiBase}/me/playlists?offset=2`,
      }),
      ok({ items: [{ id: "b" }], next: null }),
    ]);
    const { spotify } = client(send);
    const ids: string[] = [];
    for await (const item of spotify.pages("/me/playlists", meSchema))
      ids.push(item.id);
    expect(ids).toEqual(["a", "b"]);
    expect(sent[1]?.url).toBe(`${apiBase}/me/playlists?offset=2`);
  });

  it("never sends the token to a next link off the API", async () => {
    const { send, sent } = scripted([
      ok({ items: [], next: "https://evil.example/steal" }),
    ]);
    const { spotify } = client(send);
    const pages = async () => {
      const seen: string[] = [];
      for await (const item of spotify.pages("/me/playlists", meSchema))
        seen.push(item.id);
      return seen;
    };
    await expect(pages()).rejects.toThrow(/away from the API/u);
    expect(sent).toHaveLength(1);
  });

  it("refuses an answer that does not fit", async () => {
    const { send } = scripted([ok({ name: "no id" })]);
    await expect(client(send).spotify.get("/me", meSchema)).rejects.toThrow(
      /schema/u,
    );
  });
});
