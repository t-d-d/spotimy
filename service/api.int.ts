// The page's API and Spotify sign-in, end to end through the API function,
// against the fake Spotify and a local DynamoDB.
import { describe, expect, it } from "vitest";
import { statusSchema } from "../shared/page-api";
import { handler } from "./src/handler";
import { userIdSchema } from "./src/ids";
import { ready } from "./src/services";
import { lambda, publicUrl, spotify } from "../test/service-fakes.ts";

interface Options {
  query?: string;
  cookies?: string[];
  origin?: string | null;
  body?: unknown;
}

let requests = 0;

async function call(method: string, path: string, options: Options = {}) {
  requests += 1;
  const origin = options.origin === undefined ? publicUrl : options.origin;
  const answer = await handler({
    routeKey: `${method} ${path}`,
    rawPath: path,
    rawQueryString: options.query ?? "",
    cookies: options.cookies ?? [],
    headers: {
      ...(origin === null ? {} : { origin }),
      ...(options.body === undefined
        ? {}
        : { "content-type": "application/json" }),
    },
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
    isBase64Encoded: false,
    requestContext: { requestId: `req${String(requests)}`, http: { method } },
  });
  return answer;
}

// The cookie's name and value, as a browser would send it back.
const cookieFrom = (cookies: string[], name: string) => {
  const line = cookies.find((each) => each.startsWith(`${name}=`));
  return line?.split(";")[0];
};

// The whole sign-in, as the browser and Spotify would do it.
async function signIn(userId: string, name = "Thomas"): Promise<string> {
  spotify.addUser(userId, name);
  const login = await call("GET", "/api/login", { origin: null });
  const location = new URL(login.headers.location ?? "");
  const loginCookie = cookieFrom(login.cookies, "__Host-login") ?? "";
  const code = spotify.authorize(
    userId,
    location.searchParams.get("code_challenge") ?? "",
    location.searchParams.get("redirect_uri") ?? "",
  );
  const back = await call("GET", "/api/callback", {
    origin: null,
    query: new URLSearchParams({
      code,
      state: location.searchParams.get("state") ?? "",
    }).toString(),
    cookies: [loginCookie],
  });
  expect(back.statusCode).toBe(302);
  expect(back.headers.location).toBe("/");
  const session = cookieFrom(back.cookies, "__Host-session");
  if (session === undefined) throw new Error("No session cookie.");
  return session;
}

const status = async (session: string) => {
  const answer = await call("GET", "/api/status", {
    cookies: [session],
    origin: null,
  });
  expect(answer.statusCode).toBe(200);
  return statusSchema.parse(JSON.parse(answer.body));
};

describe("signing in with Spotify", () => {
  it("sends the browser to Spotify with a challenge, and keeps the verifier in a signed cookie", async () => {
    const login = await call("GET", "/api/login", { origin: null });
    expect(login.statusCode).toBe(302);
    const location = new URL(login.headers.location ?? "");
    expect(location.origin).toBe(spotify.accountsBase);
    expect(location.searchParams.get("redirect_uri")).toBe(
      `${publicUrl}/api/callback`,
    );
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(login.cookies[0]).toMatch(
      /^__Host-login=.+; Max-Age=600; Path=\/; HttpOnly; Secure; SameSite=Lax$/u,
    );
  });

  it("signs the person in, keeps their tokens, and adds them to the group", async () => {
    const session = await signIn("thomas");
    const now = await status(session);
    expect(now.user).toEqual({ id: "thomas", name: "Thomas" });
    expect(now.members).toEqual([{ id: "thomas", name: "Thomas" }]);
    expect(now.settings).toEqual({
      autoApply: false,
      followGroup: true,
      albumFirst: false,
      privatePlaylists: false,
    });
    expect(now.run.state).toBe("idle");
    expect(now.last).toBeNull();
    const tokens = await ready().store.getTokens(userIdSchema.parse("thomas"));
    expect(tokens?.refreshToken).toMatch(/\w+/u);
  });

  it("never sends tokens to the page", async () => {
    const session = await signIn("thomas");
    const answer = await call("GET", "/api/status", {
      cookies: [session],
      origin: null,
    });
    const tokens = await ready().store.getTokens(userIdSchema.parse("thomas"));
    expect(answer.body).not.toContain(tokens?.refreshToken);
    expect(answer.body).not.toContain(tokens?.accessToken);
  });

  it("refuses a callback whose state does not match", async () => {
    spotify.addUser("thomas", "Thomas");
    const login = await call("GET", "/api/login", { origin: null });
    const back = await call("GET", "/api/callback", {
      origin: null,
      query: "code=whatever&state=wrong",
      cookies: [cookieFrom(login.cookies, "__Host-login") ?? ""],
    });
    expect(back.headers.location).toBe("/?signin=failed");
    expect(cookieFrom(back.cookies, "__Host-session")).toBeUndefined();
  });

  it("says when the account is not on the Spotify app's list", async () => {
    spotify.addUser("stranger", "Stranger", { allowed: false });
    const login = await call("GET", "/api/login", { origin: null });
    const location = new URL(login.headers.location ?? "");
    const code = spotify.authorize(
      "stranger",
      location.searchParams.get("code_challenge") ?? "",
      location.searchParams.get("redirect_uri") ?? "",
    );
    const back = await call("GET", "/api/callback", {
      origin: null,
      query: new URLSearchParams({
        code,
        state: location.searchParams.get("state") ?? "",
      }).toString(),
      cookies: [cookieFrom(login.cookies, "__Host-login") ?? ""],
    });
    expect(back.headers.location).toBe("/?signin=not-allowed");
    expect(await ready().store.listMembers()).toEqual([]);
  });

  it("says when the person cancelled at Spotify", async () => {
    const back = await call("GET", "/api/callback", {
      origin: null,
      query: "error=access_denied&state=x",
    });
    expect(back.headers.location).toBe("/?signin=cancelled");
  });
});

describe("the page's API", () => {
  it("refuses everything to someone signed out", async () => {
    expect(
      (await call("GET", "/api/status", { origin: null })).statusCode,
    ).toBe(401);
    expect((await call("POST", "/api/check")).statusCode).toBe(401);
    expect(
      (
        await call("GET", "/api/status", {
          origin: null,
          cookies: ["__Host-session=forged"],
        })
      ).statusCode,
    ).toBe(401);
  });

  it("refuses a change that does not come from the page itself", async () => {
    const session = await signIn("thomas");
    const answer = await call("PUT", "/api/settings", {
      cookies: [session],
      origin: "https://evil.example",
      body: {
        autoApply: true,
        followGroup: true,
        albumFirst: false,
        privatePlaylists: false,
      },
    });
    expect(answer.statusCode).toBe(403);
    expect((await status(session)).settings.autoApply).toBe(false);
  });

  it("saves settings, and refuses ones that do not fit", async () => {
    const session = await signIn("thomas");
    const settings = {
      autoApply: true,
      followGroup: false,
      albumFirst: true,
      privatePlaylists: false,
    };
    const saved = await call("PUT", "/api/settings", {
      cookies: [session],
      body: settings,
    });
    expect(saved.statusCode).toBe(200);
    expect((await status(session)).settings).toEqual(settings);
    const bad = await call("PUT", "/api/settings", {
      cookies: [session],
      body: { autoApply: "yes" },
    });
    expect(bad.statusCode).toBe(400);
  });

  it("starts a check in the worker, holding the group's run so a second press is told it is busy", async () => {
    const session = await signIn("thomas");
    const started = await call("POST", "/api/check", { cookies: [session] });
    expect(started.statusCode).toBe(202);
    expect(lambda.invoked).toEqual([
      expect.objectContaining({
        kind: "check",
        requestedBy: "thomas",
        hop: 0,
        approved: null,
      }),
    ]);
    expect(statusSchema.parse(JSON.parse(started.body)).run).toMatchObject({
      state: "running",
      job: "check",
    });
    const again = await call("POST", "/api/check", { cookies: [session] });
    expect(again.statusCode).toBe(409);
    expect(JSON.parse(again.body)).toEqual({ error: "busy" });
    expect(lambda.invoked).toHaveLength(1);
  });

  it("starts an apply only for the plan the person was shown", async () => {
    const session = await signIn("thomas");
    const thomas = userIdSchema.parse("thomas");
    const { store } = ready();
    const plan = {
      first: true,
      save: [],
      follow: [],
      create: [],
      finish: [],
      review: [],
      ignored: { albums: 0, playlists: 0 },
    };
    await store.putMemberState(thomas, {
      memory: {
        reviewed: false,
        saved: [],
        playlists: [],
        ignoredAlbumKeys: [],
        ignoredPlaylists: [],
        ignoredPlaylistAlbumKeys: [],
        unfinished: [],
      },
      lastRun: {
        runId: "shownrun0001",
        madeAt: new Date().toISOString(),
        job: "check",
        plan,
        applied: null,
      },
    });

    const stale = await call("POST", "/api/apply", {
      cookies: [session],
      body: { plan: "olderrun0001" },
    });
    expect(stale.statusCode).toBe(409);
    expect(JSON.parse(stale.body)).toEqual({ error: "changed" });
    const missing = await call("POST", "/api/apply", { cookies: [session] });
    expect(missing.statusCode).toBe(400);
    expect(lambda.invoked).toEqual([]);

    const started = await call("POST", "/api/apply", {
      cookies: [session],
      body: { plan: "shownrun0001" },
    });
    expect(started.statusCode).toBe(202);
    expect(lambda.invoked).toEqual([
      expect.objectContaining({
        kind: "apply",
        requestedBy: "thomas",
        approved: "shownrun0001",
      }),
    ]);
  });

  it("tells the page how far a run has got, and how the last one ended", async () => {
    const session = await signIn("thomas");
    const { store } = ready();
    const thomas = userIdSchema.parse("thomas");
    const started = new Date();
    await store.takeRun(
      {
        runId: "shown0000001",
        job: "check",
        requestedBy: thomas,
        state: "running",
        startedAt: started.toISOString(),
        retryAt: null,
        expiresAt: Math.floor(started.getTime() / 1000) + 600,
        progress: null,
      },
      started,
    );
    const progress = { stage: "identifying", done: 240, total: 1130 } as const;
    await store.setProgress("shown0000001", progress);
    expect((await status(session)).run).toMatchObject({
      state: "running",
      progress,
    });

    const outcome = {
      runId: "shown0000001",
      job: "check",
      requestedBy: thomas,
      finishedAt: new Date().toISOString(),
      result: "failed",
      retryAt: null,
    } as const;
    await store.putOutcome(outcome);
    await store.endRun("shown0000001");
    const now = await status(session);
    expect(now.run).toMatchObject({ state: "idle", progress: null });
    expect(now.outcome).toEqual(outcome);
  });

  it("signs out by clearing the cookie", async () => {
    const session = await signIn("thomas");
    const answer = await call("POST", "/api/logout", { cookies: [session] });
    expect(answer.statusCode).toBe(204);
    expect(answer.cookies[0]).toMatch(/^__Host-session=; Max-Age=0/u);
  });

  it("forgets everything about a person who leaves", async () => {
    const session = await signIn("thomas");
    const answer = await call("POST", "/api/leave", { cookies: [session] });
    expect(answer.statusCode).toBe(204);
    const { store } = ready();
    const thomas = userIdSchema.parse("thomas");
    expect(await store.getTokens(thomas)).toBeUndefined();
    expect(await store.getProfile(thomas)).toBeUndefined();
    expect(await store.listMembers()).toEqual([]);
    expect(
      (await call("GET", "/api/status", { cookies: [session], origin: null }))
        .statusCode,
    ).toBe(401);
  });

  it("answers 404 to a route it does not have", async () => {
    expect(
      (await call("GET", "/api/nothing", { origin: null })).statusCode,
    ).toBe(404);
  });
});
