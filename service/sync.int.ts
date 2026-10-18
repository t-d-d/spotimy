// A whole run, end to end: the worker, the real store on a local DynamoDB,
// and the real Spotify client talking to the fake Spotify.
import { describe, expect, it } from "vitest";
import { userIdSchema, type UserId } from "./src/ids";
import type { Outcome } from "../shared/page-api";
import type { RunState } from "./src/store/store";
import type { Job } from "./src/worker";
import { ready } from "./src/services";
import { handler } from "./src/worker";
import { coverUrl } from "../test/fake-spotify.ts";
import { lambda, spotify } from "../test/service-fakes.ts";

const thomas = userIdSchema.parse("thomas");
const matt = userIdSchema.parse("matt");

const tracks = (albumId: string, count: number, from = 1) =>
  Array.from({ length: count }, (_, index) => ({
    albumId,
    index: from + index,
  }));

// Two members and one outsider, with libraries much like the real ones.
async function setUp(members: UserId[] = [thomas, matt]): Promise<void> {
  for (const [id, name, artist, count] of [
    ["Bully", "Lucky For You", "Bully", 10],
    ["Iceage", "Seek Shelter", "Iceage", 12],
    ["Cable", "All Her Plans", "Cable Ties", 9],
    ["Smile", "A Light for Attracting Attention", "The Smile", 13],
    ["Kath", "for you who are the wronged", "Kathryn Joseph", 8],
    ["Caro", "Desire, I Want To Turn Into You", "Caroline Polachek", 12],
    ["CaroDeluxe", "Desire, I Want To Turn Into You", "Caroline Polachek", 16],
    ["Mix1", "One", "Band One", 5],
    ["Mix2", "Two", "Band Two", 5],
    ["Mix3", "Three", "Band Three", 5],
    ["Mix4", "Four", "Band Four", 5],
  ] as const) {
    spotify.addAlbum({ id, name, artists: [artist], tracks: count });
  }
  spotify.addUser("thomas", "Thomas");
  spotify.addUser("matt", "Matthew");
  spotify.addUser("rich", "Rich");

  spotify.addPlaylist("matt", {
    id: "MCable",
    name: "Cable Ties – All Her Plans",
    tracks: tracks("Cable", 9),
  });
  spotify.addPlaylist("matt", {
    id: "MSmile",
    name: "The Smile – A Light for Attracting Attention",
    tracks: tracks("Smile", 13),
  });
  spotify.addPlaylist("matt", {
    id: "MMix",
    name: "Matthew's mix",
    tracks: [
      ...tracks("Mix1", 2),
      ...tracks("Mix2", 2),
      ...tracks("Mix3", 2),
      ...tracks("Mix4", 2),
    ],
  });
  spotify.save("matt", "Smile", "2024-06-01T00:00:00Z");

  spotify.addPlaylist("thomas", {
    id: "TBully",
    name: "Bully – Lucky For You",
    tracks: tracks("Bully", 10),
  });
  spotify.addPlaylist("thomas", {
    id: "TIceage",
    name: "Iceage bits",
    tracks: tracks("Iceage", 3),
  });
  spotify.follow("thomas", "MCable");
  spotify.save("thomas", "Kath", "2025-03-01T00:00:00Z");

  // An outsider's playlist: its tracks cannot be read, so its name and
  // cover art have to do.
  spotify.addPlaylist("rich", {
    id: "RCaro",
    name: "Caroline Polachek – Desire, I Want To Turn Into You",
    tracks: tracks("Caro", 12),
    images: [{ url: coverUrl("Caro") }],
  });
  spotify.follow("thomas", "RCaro");

  for (const id of members) await join(id);
}

async function join(id: UserId): Promise<void> {
  const { store } = ready();
  const names: Record<string, string> = { thomas: "Thomas", matt: "Matthew" };
  const issued = spotify.tokensFor(id);
  await store.join(
    { id, name: names[id] ?? id },
    { ...issued, expiresAt: Date.now() + 3_600_000 },
    new Date(),
  );
}

const context = (remaining: () => number = () => 600_000) => ({
  awsRequestId: "test-request",
  getRemainingTimeInMillis: remaining,
});

let runs = 0;
const nextRunId = () => {
  runs += 1;
  return `testrun${String(runs).padStart(4, "0")}`;
};

const job = (overrides: Partial<Job>): Job => ({
  kind: "check",
  requestedBy: thomas,
  runId: nextRunId(),
  hop: 0,
  approved: null,
  carried: null,
  skipped: null,
  ...overrides,
});

const check = async (remaining?: () => number) => {
  await handler(job({ kind: "check" }), context(remaining));
};

const schedule = async () => {
  await handler(job({ kind: "schedule", requestedBy: null }), context());
};

const lastRun = async (id: UserId) => {
  const last = await ready().store.getLastRun(id);
  if (last === undefined) throw new Error(`${id} has no plan.`);
  return last;
};

// Applies the plan the person was last shown, as pressing Apply does.
const apply = async (id: UserId = thomas, remaining?: () => number) => {
  const shown = await ready().store.getLastRun(id);
  await handler(
    job({ kind: "apply", requestedBy: id, approved: shown?.runId ?? null }),
    context(remaining),
  );
};

const writes = () => spotify.calls.filter((call) => call.method !== "GET");

const namesIn = (id: string) =>
  spotify.library(id).playlists.map((each) => spotify.playlist(each)?.name);

describe("a check", () => {
  it("plans for every member and changes nothing", async () => {
    await setUp();
    await check();

    expect(writes()).toEqual([]);
    const forThomas = (await lastRun(thomas)).plan;
    expect(forThomas.first).toBe(true);
    expect(forThomas.save).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ albumId: "Bully", match: "tracks" }),
        expect.objectContaining({ albumId: "Cable", match: "tracks" }),
        expect.objectContaining({ albumId: "Caro", match: "cover" }),
        expect.objectContaining({ albumId: "Smile", match: "tracks" }),
      ]),
    );
    expect(forThomas.save).toHaveLength(4);
    expect(forThomas.follow).toEqual([
      {
        playlistId: "MSmile",
        name: "The Smile – A Light for Attracting Attention",
        ownerName: "Matthew",
      },
    ]);
    expect(forThomas.create).toEqual([
      {
        albumId: "Kath",
        name: "Kathryn Joseph – for you who are the wronged",
        year: "2025",
      },
    ]);
    expect(
      forThomas.review.map((entry) => [entry.playlist, entry.kind]),
    ).toEqual([["Iceage bits", "partial"]]);

    const forMatt = (await lastRun(matt)).plan;
    expect(forMatt.follow.map((entry) => entry.playlistId)).toEqual(["TBully"]);
    expect(forMatt.save.map((entry) => entry.albumId).sort()).toEqual([
      "Bully",
      "Cable",
    ]);
    expect(forMatt.create).toEqual([]);
    expect(forMatt.review.map((entry) => entry.kind)).toEqual(["mixed"]);
  });

  it("reads a member's own playlist with the member's own token, never twice, and only through /items", async () => {
    await setUp();
    await check();
    const reads = spotify.calls.filter((call) =>
      /^\/playlists\/\w+\//u.test(call.path),
    );
    expect(
      reads.every((call) => /^\/playlists\/\w+\/items/u.test(call.path)),
    ).toBe(true);
    expect(
      reads
        .filter((call) => call.path.startsWith("/playlists/MCable/"))
        .every((call) => call.userId === "matt"),
    ).toBe(true);

    spotify.calls.length = 0;
    await check();
    expect(
      spotify.calls.filter((call) =>
        /^\/playlists\/\w+\/items/u.test(call.path),
      ),
    ).toEqual([]);
  });

  it("leaves a member's playlists unread while that member cannot be reached", async () => {
    await setUp();
    await ready().store.putTokens(matt, {
      accessToken: "gone",
      refreshToken: "revoked",
      expiresAt: 0,
    });
    await check();
    expect(await ready().store.getLastRun(matt)).toBeUndefined();
    const verdicts = await ready().store.getVerdicts();
    expect(verdicts.has("MCable")).toBe(false);
    expect(
      (await lastRun(thomas)).plan.save.map((entry) => entry.albumId),
    ).not.toContain("Cable");
  });
});

describe("an apply", () => {
  it("changes only the library of the person who asked", async () => {
    await setUp();
    await check();
    const mattBefore = spotify.library("matt");
    await apply(thomas);

    const library = spotify.library("thomas");
    expect(library.saved).toEqual(
      expect.arrayContaining(["Bully", "Cable", "Caro", "Smile", "Kath"]),
    );
    expect(library.playlists).toContain("MSmile");
    const made = library.playlists.flatMap((id) => {
      const playlist = spotify.playlist(id);
      return playlist?.name === "Kathryn Joseph – for you who are the wronged"
        ? [playlist]
        : [];
    });
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({ ownerId: "thomas", public: true });
    expect(made[0]?.tracks).toHaveLength(8);
    expect(spotify.library("matt")).toEqual(mattBefore);

    const after = await lastRun(thomas);
    expect(after.applied).toMatchObject({
      saved: 4,
      followed: 1,
      failed: 0,
      unfinished: false,
    });
    expect(after.applied?.created).toEqual([
      { name: "Kathryn Joseph – for you who are the wronged", year: "2025" },
    ]);
    expect(after.plan.first).toBe(false);
    expect([after.plan.save, after.plan.follow, after.plan.create]).toEqual([
      [],
      [],
      [],
    ]);
  });

  it("applies only what was in the plan the person saw", async () => {
    await setUp();
    await check();
    // Something new arrives after the person looked.
    spotify.addAlbum({
      id: "Wall",
      name: "Wall of Eyes",
      artists: ["The Smile"],
      tracks: 8,
    });
    spotify.addPlaylist("matt", {
      id: "MWall",
      name: "The Smile – Wall of Eyes",
      tracks: tracks("Wall", 8),
    });
    await apply(thomas);
    expect(spotify.library("thomas").playlists).not.toContain("MWall");
    expect(spotify.library("thomas").saved).not.toContain("Wall");
    // It waits in the next plan for them to see.
    expect(
      (await lastRun(thomas)).plan.follow.map((entry) => entry.playlistId),
    ).toEqual(["MWall"]);
  });

  it("does nothing when the plan it names has been replaced", async () => {
    await setUp();
    await check();
    const seen = (await lastRun(thomas)).runId;
    await check();
    spotify.calls.length = 0;
    await handler(
      job({ kind: "apply", requestedBy: thomas, approved: seen }),
      context(),
    );
    expect(writes()).toEqual([]);
  });

  it("leaves nothing to do the next time, and offers the new playlist to the group", async () => {
    await setUp();
    await check();
    await apply(thomas);
    await check();
    const forThomas = (await lastRun(thomas)).plan;
    expect([forThomas.save, forThomas.follow, forThomas.create]).toEqual([
      [],
      [],
      [],
    ]);
    const forMatt = (await lastRun(matt)).plan;
    expect(forMatt.follow.map((entry) => entry.name)).toContain(
      "Kathryn Joseph – for you who are the wronged",
    );
  });

  it("keeps showing what was applied after someone else's check", async () => {
    await setUp();
    await check();
    await apply(thomas);
    const applied = (await lastRun(thomas)).applied;
    await handler(job({ kind: "check", requestedBy: matt }), context());
    expect((await lastRun(thomas)).applied).toEqual(applied);
  });

  it("never puts back what the person removed", async () => {
    await setUp();
    await check();
    await apply(thomas);
    spotify.unsave("thomas", "Bully");
    spotify.unfollow("thomas", "MSmile");
    await check();
    await apply(thomas);
    const library = spotify.library("thomas");
    expect(library.saved).not.toContain("Bully");
    expect(library.playlists).not.toContain("MSmile");
    expect((await lastRun(thomas)).plan.ignored).toEqual({
      albums: 1,
      playlists: 1,
    });
  });
});

describe("the daily schedule", () => {
  it("applies only for those who turned it on and have applied once themselves", async () => {
    await setUp();
    const { store } = ready();
    await store.putSettings(matt, {
      autoApply: true,
      followGroup: true,
      albumFirst: false,
      privatePlaylists: false,
    });
    await schedule();
    await schedule();
    expect(writes()).toEqual([]);

    await apply(matt);
    spotify.addAlbum({
      id: "Wall",
      name: "Wall of Eyes",
      artists: ["The Smile"],
      tracks: 8,
    });
    spotify.save("matt", "Wall", "2026-10-01T00:00:00Z");
    await schedule();
    expect(namesIn("matt")).toContain("The Smile – Wall of Eyes");
    expect(spotify.library("thomas").saved).not.toContain("Bully");
  });
});

describe("limits and failures", () => {
  it("pauses when Spotify asks for a long wait, and holds the group's run until then", async () => {
    await setUp();
    spotify.limitNext(1, 3600);
    await check();
    const lock = await ready().store.getRun();
    expect(lock).toMatchObject({ state: "paused" });
    expect(Date.parse(lock?.retryAt ?? "")).toBeGreaterThan(
      Date.now() + 3_500_000,
    );

    spotify.calls.length = 0;
    await check();
    expect(spotify.calls).toEqual([]);
  });

  it("carries on in a fresh invocation when time runs short, keeping the run", async () => {
    await setUp();
    await check(() => 1000);
    expect(lambda.invoked).toHaveLength(1);
    const next = lambda.invoked[0];
    expect(next).toMatchObject({ kind: "check", hop: 1 });
    expect(await ready().store.getRun()).toMatchObject({ state: "running" });

    await handler(next, context());
    expect((await lastRun(thomas)).plan.save).toHaveLength(4);
    expect(await ready().store.getRun()).toBeUndefined();
  });

  it("carries an apply on in a fresh invocation without doing anything twice", async () => {
    await setUp();
    spotify.addAlbum({
      id: "Wall",
      name: "Wall of Eyes",
      artists: ["The Smile"],
      tracks: 8,
    });
    spotify.save("thomas", "Wall", "2026-10-01T00:00:00Z");
    await check();
    // Time runs short once the first new playlist is made.
    await apply(thomas, () =>
      spotify.calls.some(
        (call) => call.method === "POST" && call.path === "/me/playlists",
      )
        ? 1000
        : 600_000,
    );
    expect(lambda.invoked).toHaveLength(1);
    expect(
      namesIn("thomas").filter(
        (name) =>
          name?.includes("Kathryn") === true || name?.includes("Wall") === true,
      ),
    ).toHaveLength(1);

    await handler(lambda.invoked[0], context());
    const names = namesIn("thomas");
    expect(
      names.filter(
        (name) => name === "Kathryn Joseph – for you who are the wronged",
      ),
    ).toHaveLength(1);
    expect(
      names.filter((name) => name === "The Smile – Wall of Eyes"),
    ).toHaveLength(1);
    const applied = (await lastRun(thomas)).applied;
    expect(applied?.created).toHaveLength(2);
    expect(applied).toMatchObject({ saved: 4, followed: 1, unfinished: false });
  });

  it("remembers what an apply did before Spotify stopped it, and says it is unfinished", async () => {
    await setUp();
    await check();
    spotify.limitMatching(
      (method, path) => method === "POST" && path === "/me/playlists",
      1,
      3600,
    );
    await apply(thomas);
    const after = await lastRun(thomas);
    expect(after.applied).toMatchObject({
      saved: 4,
      followed: 1,
      unfinished: true,
    });
    expect(after.plan.create.map((entry) => entry.albumId)).toEqual(["Kath"]);

    // The person unsaves an album spotimy just saved. The next apply leaves it.
    spotify.unsave("thomas", "Bully");
    await ready().store.endRun((await ready().store.getRun())?.runId ?? "");
    await check();
    await apply(thomas);
    expect(spotify.library("thomas").saved).not.toContain("Bully");
    expect(namesIn("thomas")).toContain(
      "Kathryn Joseph – for you who are the wronged",
    );
  });

  it("finishes a playlist it made but could not fill", async () => {
    await setUp();
    await check();
    spotify.limitMatching(
      (method, path) =>
        method === "POST" && /^\/playlists\/\w+\/items$/u.test(path),
      1,
      3600,
    );
    await apply(thomas);
    const made = spotify
      .library("thomas")
      .playlists.find(
        (id) =>
          spotify.playlist(id)?.name ===
          "Kathryn Joseph – for you who are the wronged",
      );
    expect(made).toBeDefined();
    expect(spotify.playlist(made ?? "")?.tracks).toHaveLength(0);
    expect((await lastRun(thomas)).plan.finish).toEqual([
      {
        playlistId: made,
        name: "Kathryn Joseph – for you who are the wronged",
      },
    ]);

    await ready().store.endRun((await ready().store.getRun())?.runId ?? "");
    await apply(thomas);
    expect(spotify.playlist(made ?? "")?.tracks).toHaveLength(8);
    expect(
      namesIn("thomas").filter(
        (name) => name === "Kathryn Joseph – for you who are the wronged",
      ),
    ).toHaveLength(1);
    expect((await lastRun(thomas)).plan.finish).toEqual([]);
  });

  it("skips a member whose Spotify access is gone, and plans for the rest", async () => {
    await setUp();
    const { store } = ready();
    await store.putTokens(matt, {
      accessToken: "gone",
      refreshToken: "revoked",
      expiresAt: 0,
    });
    await check();
    expect(await store.getLastRun(matt)).toBeUndefined();
    expect((await lastRun(thomas)).plan.save.length).toBeGreaterThan(0);
  });

  it("keeps nothing of someone who left during a run", async () => {
    await setUp();
    const { store } = ready();
    await store.leave(thomas);
    expect(
      await store.putMemberState(thomas, {
        memory: {
          reviewed: true,
          saved: [],
          playlists: [],
          ignoredAlbumKeys: [],
          ignoredPlaylists: [],
          ignoredPlaylistAlbumKeys: [],
          unfinished: [],
        },
      }),
    ).toBe(false);
    expect(await store.getMemory(thomas)).toBeUndefined();
    expect(
      await store.putTokens(thomas, {
        accessToken: "a",
        refreshToken: "r",
        expiresAt: 0,
      }),
    ).toBe(false);
    expect(await store.getTokens(thomas)).toBeUndefined();
  });

  it("does nothing while another run holds the group", async () => {
    await setUp();
    const { store } = ready();
    await store.takeRun(
      {
        runId: "otherrun0001",
        job: "check",
        requestedBy: null,
        state: "running",
        startedAt: new Date().toISOString(),
        retryAt: null,
        expiresAt: Math.floor(Date.now() / 1000) + 600,
        progress: null,
      },
      new Date(),
    );
    await check();
    expect(spotify.calls).toEqual([]);
    expect(await store.getLastRun(thomas)).toBeUndefined();
  });

  it("skips local files in a playlist and still reads the rest", async () => {
    await setUp();
    spotify.addAlbum({
      id: "Wall",
      name: "Wall of Eyes",
      artists: ["The Smile"],
      tracks: 8,
    });
    spotify.addPlaylist("thomas", {
      id: "TWall",
      name: "The Smile – Wall of Eyes",
      tracks: tracks("Wall", 8),
      localFiles: 2,
    });
    await check();
    expect(
      (await lastRun(thomas)).plan.save.map((entry) => entry.albumId),
    ).toContain("Wall");
  });
});

describe("refusals about one playlist", () => {
  const searches = () =>
    spotify.calls.filter((call) => call.path.startsWith("/search"));

  it("skips a playlist whose search Spotify refuses, plans the rest, and tries it again next run", async () => {
    await setUp();
    let refusing = true;
    spotify.failMatching(
      (method, path, query) =>
        refusing &&
        method === "GET" &&
        path === "/search" &&
        (query.get("q") ?? "").includes("Desire"),
      400,
    );
    await check();
    expect(await ready().store.getOutcome()).toMatchObject({
      result: "finished",
    });
    const saves = (await lastRun(thomas)).plan.save.map(
      (entry) => entry.albumId,
    );
    expect(saves).toEqual(expect.arrayContaining(["Bully", "Cable", "Smile"]));
    expect(saves).not.toContain("Caro");
    expect((await ready().store.getVerdicts()).has("RCaro")).toBe(false);

    refusing = false;
    await check();
    expect(
      (await lastRun(thomas)).plan.save.map((entry) => entry.albumId),
    ).toContain("Caro");
  });

  it("stops searching by name for the rest of the run once Spotify refuses search", async () => {
    await setUp();
    spotify.addPlaylist("rich", {
      id: "RKath",
      name: "Kathryn Joseph – for you who are the wronged",
      tracks: tracks("Kath", 8),
      images: [{ url: coverUrl("Kath") }],
    });
    spotify.follow("thomas", "RKath");
    spotify.failMatching(
      (method, path) => method === "GET" && path === "/search",
      403,
    );
    await check();
    expect(await ready().store.getOutcome()).toMatchObject({
      result: "finished",
    });
    expect(searches()).toHaveLength(1);
  });

  it("keeps what it skipped for the whole run, across invocations", async () => {
    await setUp();
    spotify.addPlaylist("rich", {
      id: "RKath",
      name: "Kathryn Joseph – for you who are the wronged",
      tracks: tracks("Kath", 8),
      images: [{ url: coverUrl("Kath") }],
    });
    spotify.follow("thomas", "RKath");
    spotify.failMatching(
      (method, path) => method === "GET" && path === "/search",
      403,
    );
    // Time runs short straight after the refused search.
    await check(() => (searches().length > 0 ? 1000 : 600_000));
    const next = lambda.invoked[0];
    if (next === undefined) throw new Error("The run did not carry on.");
    await handler(next, context());
    expect(await ready().store.getOutcome()).toMatchObject({
      result: "finished",
    });
    expect(searches()).toHaveLength(1);
  });

  it("skips a member's playlist Spotify will not read, and plans the rest", async () => {
    await setUp();
    spotify.failMatching(
      (method, path) => method === "GET" && path === "/playlists/TIceage/items",
      404,
    );
    await check();
    expect(await ready().store.getOutcome()).toMatchObject({
      result: "finished",
    });
    expect(
      (await lastRun(thomas)).plan.save.map((entry) => entry.albumId),
    ).toContain("Bully");
    expect((await ready().store.getVerdicts()).has("TIceage")).toBe(false);
  });
});

describe("what the page sees", () => {
  it("records how each run ended", async () => {
    await setUp();
    await check();
    expect(await ready().store.getOutcome()).toMatchObject({
      job: "check",
      result: "finished",
    });

    await ready().store.endRun((await ready().store.getRun())?.runId ?? "");
    spotify.limitNext(1, 3600);
    await check();
    expect(await ready().store.getOutcome()).toMatchObject({
      result: "paused",
    });
    expect((await ready().store.getOutcome())?.retryAt).not.toBeNull();
  });

  it("records a failed run, and frees the group", async () => {
    await setUp();
    spotify.failMatching(
      (method, path) => method === "GET" && path === "/me/albums",
      400,
    );
    await check().catch(() => undefined);
    expect(await ready().store.getOutcome()).toMatchObject({
      result: "failed",
    });
    expect(await ready().store.getRun()).toBeUndefined();
  });

  it("leaves a stopped ending on record when a run's next invocation never comes", async () => {
    await setUp();
    await check(() => 1000);
    const outcome = await ready().store.getOutcome();
    expect(outcome).toMatchObject({
      job: "check",
      requestedBy: "thomas",
      result: "stopped",
    });
    expect(lambda.invoked).toEqual([
      expect.objectContaining({ runId: outcome?.runId, hop: 1 }),
    ]);
  });

  it("counts playlists on across invocations, never back", async () => {
    await setUp();
    // Time runs short once three playlists have been read.
    const read = () =>
      new Set(
        spotify.calls.flatMap(
          (call) => /^\/playlists\/([^/]+)\/items/u.exec(call.path)?.[1] ?? [],
        ),
      ).size;
    await check(() => (read() >= 3 ? 1000 : 600_000));
    expect((await ready().store.getRun())?.progress).toMatchObject({
      stage: "identifying",
      total: 6,
    });
    const next = lambda.invoked[0];
    if (next === undefined) throw new Error("The run did not carry on.");
    await handler(
      next,
      context(() => 1000),
    );
    expect((await ready().store.getRun())?.progress).toEqual({
      stage: "identifying",
      done: 3,
      total: 6,
    });
  });

  it("counts changes on across invocations, never back", async () => {
    await setUp();
    spotify.addAlbum({
      id: "Wall",
      name: "Wall of Eyes",
      artists: ["The Smile"],
      tracks: 8,
    });
    spotify.save("thomas", "Wall", "2026-10-01T00:00:00Z");
    await check();
    // Four saves, one follow and one new playlist, then time runs short.
    await apply(thomas, () =>
      spotify.calls.some(
        (call) => call.method === "POST" && call.path === "/me/playlists",
      )
        ? 1000
        : 600_000,
    );
    const counted = { stage: "applying", done: 6, total: 7 };
    expect((await ready().store.getRun())?.progress).toEqual(counted);
    const next = lambda.invoked[0];
    if (next === undefined) throw new Error("The apply did not carry on.");
    await handler(
      next,
      context(() => 1000),
    );
    expect((await ready().store.getRun())?.progress).toEqual(counted);
  });
});

describe("the run's record", () => {
  const holding = (runId: string): RunState => ({
    runId,
    job: "check",
    requestedBy: thomas,
    state: "running",
    startedAt: new Date().toISOString(),
    retryAt: null,
    expiresAt: Math.floor(Date.now() / 1000) + 600,
    progress: null,
  });
  const ending = (runId: string): Outcome => ({
    runId,
    job: "check",
    requestedBy: thomas,
    finishedAt: new Date().toISOString(),
    result: "failed",
    retryAt: null,
  });

  it("takes progress and an ending only from the run that holds the group", async () => {
    const { store } = ready();
    await store.takeRun(holding("holder000001"), new Date());
    await store.setProgress("lapsed000001", {
      stage: "reading",
      done: 1,
      total: 2,
    });
    await store.putOutcome(ending("lapsed000001"));
    expect((await store.getRun())?.progress).toBeNull();
    expect(await store.getOutcome()).toBeUndefined();

    await store.putOutcome(ending("holder000001"));
    expect((await store.getOutcome())?.runId).toBe("holder000001");
  });

  it("never brings back a run that has ended", async () => {
    const { store } = ready();
    await store.takeRun(holding("holder000001"), new Date());
    await store.endRun("holder000001");
    await store.setProgress("holder000001", {
      stage: "reading",
      done: 1,
      total: 2,
    });
    expect(await store.getRun()).toBeUndefined();
  });
});
