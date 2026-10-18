import { describe, expect, it } from "vitest";
import { z } from "zod";
import { errorFields, silentLogger } from "../log";
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
  const counted = { calls: 0 };
  let token = "first";
  return {
    waits,
    counted,
    spotify: createSpotifyClient({
      onCall: () => {
        counted.calls += 1;
      },
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

  it("counts every call it sends, retries and pages included, for the day's allowance", async () => {
    const { send } = scripted([
      status(503),
      ok({ items: [{ id: "a" }], next: `${apiBase}/me/playlists?offset=1` }),
      ok({ items: [{ id: "b" }], next: null }),
    ]);
    const { spotify, counted } = client(send);
    for await (const item of spotify.pages("/me/playlists", meSchema)) {
      expect(item.id).toMatch(/^[ab]$/u);
    }
    expect(counted.calls).toBe(3);
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

  it("names Spotify's reason for a refusal by a fixed code, never its words", async () => {
    const refusal = (message: string) => () =>
      Response.json({ error: { status: 403, message } }, { status: 403 });
    const caught = async (answer: () => Response) => {
      const { send } = scripted([answer]);
      return client(send)
        .spotify.get("/search?q=x", meSchema)
        .then(
          () => undefined,
          (error: unknown) => error,
        );
    };

    expect(
      errorFields(
        await caught(
          refusal(
            "Active premium subscription required for the owner of the app.",
          ),
        ),
      ),
    ).toEqual({ errorClass: "SpotifyError:PremiumRequired", status: 403 });
    expect(
      errorFields(await caught(refusal("Insufficient client scope"))),
    ).toEqual({ errorClass: "SpotifyError:InsufficientScope", status: 403 });
    expect(errorFields(await caught(refusal("Forbidden")))).toEqual({
      errorClass: "SpotifyError:Forbidden",
      status: 403,
    });
    expect(
      errorFields(
        await caught(
          refusal(
            "Check settings on developer.spotify.com/dashboard, the user may not be registered.",
          ),
        ),
      ),
    ).toEqual({ errorClass: "SpotifyError:UserNotRegistered", status: 403 });
    const unknown = await caught(refusal("Bully Lucky For You"));
    expect(errorFields(unknown)).toEqual({
      errorClass: "SpotifyError:Other",
      status: 403,
    });
    expect(unknown instanceof Error ? unknown.message : "").not.toMatch(
      /Bully/u,
    );
    expect(JSON.stringify(errorFields(unknown))).not.toMatch(/Bully/u);
    expect(errorFields(await caught(status(403)))).toEqual({
      errorClass: "SpotifyError",
      status: 403,
    });
  });

  it("refuses a page with an item that does not fit, so a missing album is never taken for a removed one", async () => {
    const { send } = scripted([
      ok({ items: [{ id: "a" }, { name: "no id" }], next: null }),
    ]);
    const { spotify } = client(send);
    const pages = async () => {
      const seen: string[] = [];
      for await (const item of spotify.pages("/me/albums", meSchema))
        seen.push(item.id);
      return seen;
    };
    await expect(pages()).rejects.toThrow(/schema/u);
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
