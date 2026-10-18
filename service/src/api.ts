// The page's API and Spotify sign-in (identity.md).
import {
  applyRequestSchema,
  defaultSettings,
  settingsSchema,
  type Refusal,
  type Status,
} from "../../shared/page-api";
import type { UserId } from "./ids";
import { newRunId } from "./jobs";
import { errorClass, type Logger } from "./log";
import type { Route } from "./routes";
import type { Services } from "./services";
import {
  clearCookie,
  loginCookie,
  loginSeconds,
  sessionCookie,
  sessionSeconds,
  setCookie,
} from "./session";
import { parsedBody } from "./http";
import {
  authorizeUrl,
  exchangeCode,
  newLogin,
  storedTokens,
} from "./spotify/auth";
import { createSpotifyClient, SpotifyError } from "./spotify/client";
import { meSchema } from "./spotify/schemas";
import { lockSeconds } from "./sync/run";

export interface Call {
  route: Route;
  request: Request;
  cookies: Map<string, string>;
  log: Logger;
}

const noStore = { "cache-control": "no-store" };

const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: noStore });

const refuse = (status: number, error: Refusal) => json(status, { error });

function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ location, ...noStore });
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(null, { status: 302, headers });
}

function empty(status: number, cookies: string[] = []): Response {
  const headers = new Headers(noStore);
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(null, { status, headers });
}

export async function serve(call: Call, services: Services): Promise<Response> {
  const { route, request, log } = call;
  const { env } = services;

  // A change must come from the page itself (identity.md).
  if (
    request.method !== "GET" &&
    request.headers.get("origin") !== env.publicUrl
  ) {
    log.info("origin-refused");
    return refuse(403, "origin");
  }

  switch (route) {
    case "GET /api/login":
      return startSignIn(services, log);
    case "GET /api/callback":
      return finishSignIn(call, services);
    case "POST /api/logout":
      log.info("signed-out");
      return empty(204, [clearCookie(sessionCookie)]);
    case "GET /api/status":
    case "PUT /api/settings":
    case "POST /api/check":
    case "POST /api/apply":
    case "POST /api/leave":
      break;
  }

  const userId = await services.sessions.verifySession(
    call.cookies.get(sessionCookie),
  );
  if (userId === undefined) {
    log.info(
      call.cookies.has(sessionCookie) ? "session-rejected" : "session-missing",
    );
    return refuse(401, "signed-out");
  }
  // Someone who left still holds a cookie until it expires.
  const profile = await services.store.getProfile(userId);
  if (profile === undefined) {
    return refuse(401, "signed-out");
  }

  switch (route) {
    case "GET /api/status":
      return json(200, await status(userId, services));
    case "PUT /api/settings": {
      const settings = await parsedBody(request, settingsSchema);
      if (settings === undefined) {
        log.info("input-invalid", { userId });
        return refuse(400, "invalid");
      }
      await services.store.putSettings(userId, settings);
      log.info("settings-saved", { userId });
      return json(200, await status(userId, services));
    }
    case "POST /api/check":
    case "POST /api/apply":
      return startRun(
        route === "POST /api/apply" ? "apply" : "check",
        call.request,
        userId,
        services,
        log,
      );
    case "POST /api/leave":
      await services.store.leave(userId);
      log.info("left", { userId });
      return empty(204, [clearCookie(sessionCookie)]);
  }
}

async function startSignIn(services: Services, log: Logger): Promise<Response> {
  const { env, sessions } = services;
  const login = newLogin();
  log.info("sign-in-started");
  return redirect(
    authorizeUrl({
      accountsBase: env.spotifyAccountsBase,
      clientId: env.spotifyClientId,
      redirectUri: `${env.publicUrl}/api/callback`,
      state: login.state,
      verifier: login.verifier,
    }),
    [setCookie(loginCookie, await sessions.signLogin(login), loginSeconds)],
  );
}

async function finishSignIn(call: Call, services: Services): Promise<Response> {
  const { env, sessions, store, now } = services;
  const { log } = call;
  const query = new URL(call.request.url).searchParams;
  const login = await sessions.verifyLogin(call.cookies.get(loginCookie));
  const code = query.get("code");
  const failed = (reason: string, errorName: string) => {
    log.info("sign-in-refused", { errorClass: errorName });
    return redirect(`/?signin=${reason}`, [clearCookie(loginCookie)]);
  };
  if (query.get("error") !== null) return failed("cancelled", "Cancelled");
  if (
    login === undefined ||
    code === null ||
    query.get("state") !== login.state
  ) {
    return failed("failed", "StateMismatch");
  }
  let answer;
  try {
    answer = await exchangeCode({
      accountsBase: env.spotifyAccountsBase,
      clientId: env.spotifyClientId,
      redirectUri: `${env.publicUrl}/api/callback`,
      code,
      verifier: login.verifier,
    });
  } catch (error) {
    return failed("failed", errorClass(error));
  }
  const tokens = storedTokens(answer, now());
  if (tokens === undefined) return failed("failed", "NoRefreshToken");
  const client = createSpotifyClient({
    apiBase: env.spotifyApiBase,
    log,
    tokens: {
      current: () => Promise.resolve(tokens.accessToken),
      renew: () => Promise.resolve(tokens.accessToken),
    },
  });
  let me;
  try {
    me = await client.get("/me", meSchema);
  } catch (error) {
    // A development-mode app answers 403 for an account not on its list.
    if (error instanceof SpotifyError && error.status === 403) {
      return failed("not-allowed", "NotOnList");
    }
    return failed("failed", errorClass(error));
  }
  await store.join(
    { id: me.id, name: me.display_name ?? me.id },
    tokens,
    now(),
  );
  log.info("signed-in", { userId: me.id });
  return redirect("/", [
    clearCookie(loginCookie),
    setCookie(sessionCookie, await sessions.signSession(me.id), sessionSeconds),
  ]);
}

async function startRun(
  kind: "check" | "apply",
  request: Request,
  userId: UserId,
  services: Services,
  log: Logger,
): Promise<Response> {
  const { store, now } = services;
  // An apply names the plan the person saw. If a run has made a newer one
  // since, they look again first (sync-safety.md).
  let approved: string | null = null;
  if (kind === "apply") {
    const body = await parsedBody(request, applyRequestSchema);
    if (body === undefined) {
      log.info("input-invalid", { userId });
      return refuse(400, "invalid");
    }
    const last = await store.getLastRun(userId);
    if (last?.runId !== body.plan) {
      log.info("apply-refused", { userId });
      return refuse(409, "changed");
    }
    approved = body.plan;
  }
  // The lock is taken here, so a second press while the first is starting
  // is told the group is busy, rather than started and dropped.
  const runId = newRunId();
  const taken = await store.takeRun(
    {
      runId,
      job: kind,
      requestedBy: userId,
      state: "running",
      startedAt: now().toISOString(),
      retryAt: null,
      expiresAt: Math.floor(now().getTime() / 1000) + lockSeconds,
    },
    now(),
  );
  if (!taken) {
    log.info("run-busy", { userId, job: kind });
    return refuse(409, "busy");
  }
  try {
    await services.startJob({
      kind,
      requestedBy: userId,
      runId,
      hop: 0,
      approved,
      carried: null,
    });
  } catch (error) {
    await store.endRun(runId);
    throw error;
  }
  log.info("run-requested", { userId, job: kind, runId });
  return json(202, await status(userId, services));
}

async function status(userId: UserId, services: Services): Promise<Status> {
  const { store, now } = services;
  const [profile, members, run, last] = await Promise.all([
    store.getProfile(userId),
    store.listMembers(),
    store.getRun(),
    store.getLastRun(userId),
  ]);
  const nowSeconds = Math.floor(now().getTime() / 1000);
  const active =
    run !== undefined && run.expiresAt > nowSeconds ? run : undefined;
  return {
    user: { id: userId, name: profile?.name ?? userId },
    members,
    settings: profile?.settings ?? defaultSettings,
    run: {
      state: active?.state ?? "idle",
      job: active?.job ?? null,
      startedAt: active?.startedAt ?? null,
      retryAt: active?.retryAt ?? null,
    },
    last: last ?? null,
  };
}
