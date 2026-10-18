// A whole run, end to end: the worker, the real store on a local DynamoDB,
// and the real Spotify client talking to the fake Spotify.
import { describe, expect, it } from "vitest";
import { userIdSchema, type UserId } from "./src/ids";
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
async function setUp(): Promise<void> {
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

  const { store } = ready();
  for (const [id, name] of [
    [thomas, "Thomas"],
    [matt, "Matthew"],
  ] as const) {
    const issued = spotify.tokensFor(id);
    await store.join(
      { id, name },
      { ...issued, expiresAt: Date.now() + 3_600_000 },
      new Date(),
    );
  }
}

const context = (remaining = 600_000) => ({
  awsRequestId: "test-request",
  getRemainingTimeInMillis: () => remaining,
});

let runs = 0;
async function run(
  kind: "check" | "apply" | "schedule",
  requestedBy: UserId | null = thomas,
  remaining?: number,
) {
  runs += 1;
  await handler(
    {
      kind,
      requestedBy: kind === "schedule" ? null : requestedBy,
      runId: `testrun${String(runs).padStart(4, "0")}`,
      hop: 0,
    },
    context(remaining),
  );
}

const lastRun = async (id: UserId) => {
  const last = await ready().store.getLastRun(id);
  if (last === undefined) throw new Error(`${id} has no plan.`);
  return last;
};

const writes = () => spotify.calls.filter((call) => call.method !== "GET");

describe("a check", () => {
  it("plans for every member and changes nothing", async () => {
    await setUp();
    await run("check");

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

  it("reads a member's own playlist with the member's own token, and never reads it twice", async () => {
    await setUp();
    await run("check");
    const reads = spotify.calls.filter((call) =>
      /^\/playlists\/\w+\/items/u.test(call.path),
    );
    expect(
      reads
        .filter((call) => call.path.startsWith("/playlists/MCable/"))
        .every((call) => call.userId === "matt"),
    ).toBe(true);
    expect(
      reads.some((call) => call.path.startsWith("/playlists/RCaro/")),
    ).toBe(true);

    spotify.calls.length = 0;
    await run("check");
    expect(
      spotify.calls.filter((call) =>
        /^\/playlists\/\w+\/items/u.test(call.path),
      ),
    ).toEqual([]);
  });
});

describe("an apply", () => {
  it("changes only the library of the person who asked", async () => {
    await setUp();
    await run("check");
    const mattBefore = spotify.library("matt");
    await run("apply", thomas);

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

    const applied = (await lastRun(thomas)).applied;
    expect(applied).toMatchObject({ saved: 4, followed: 1, failed: 0 });
    expect(applied?.created).toEqual([
      { name: "Kathryn Joseph – for you who are the wronged", year: "2025" },
    ]);
  });

  it("leaves nothing to do the next time, and offers the new playlist to the group", async () => {
    await setUp();
    await run("apply", thomas);
    await run("check");
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

  it("never puts back what the person removed", async () => {
    await setUp();
    await run("apply", thomas);
    spotify.unsave("thomas", "Bully");
    spotify.unfollow("thomas", "MSmile");
    await run("apply", thomas);
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
  it("applies for those who turned it on, but never a first plan", async () => {
    await setUp();
    const { store } = ready();
    await store.putSettings(matt, {
      autoApply: true,
      followGroup: true,
      albumFirst: false,
      privatePlaylists: false,
    });
    await run("schedule");
    expect(writes()).toEqual([]);
    await run("schedule");
    expect(spotify.library("matt").playlists).toContain("TBully");
    expect(spotify.library("thomas").saved).not.toContain("Bully");
  });
});

describe("limits and failures", () => {
  it("pauses when Spotify asks for a long wait, and holds the group's run until then", async () => {
    await setUp();
    spotify.limitNext(1, 3600);
    await run("check");
    const lock = await ready().store.getRun();
    expect(lock).toMatchObject({ state: "paused" });
    expect(Date.parse(lock?.retryAt ?? "")).toBeGreaterThan(
      Date.now() + 3_500_000,
    );

    spotify.calls.length = 0;
    await run("check");
    expect(spotify.calls).toEqual([]);
  });

  it("carries on in a fresh invocation when time runs short, keeping the run", async () => {
    await setUp();
    await run("check", thomas, 1000);
    expect(lambda.invoked).toHaveLength(1);
    const next = lambda.invoked[0];
    expect(next).toMatchObject({ kind: "check", hop: 1 });
    expect(await ready().store.getRun()).toMatchObject({ state: "running" });

    await handler(next, context());
    expect((await lastRun(thomas)).plan.save).toHaveLength(4);
    expect(await ready().store.getRun()).toBeUndefined();
  });

  it("skips a member whose Spotify access is gone, and plans for the rest", async () => {
    await setUp();
    const { store } = ready();
    await store.putTokens(matt, {
      accessToken: "gone",
      refreshToken: "revoked",
      expiresAt: 0,
    });
    await run("check");
    expect(await store.getLastRun(matt)).toBeUndefined();
    expect((await lastRun(thomas)).plan.save.length).toBeGreaterThan(0);
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
      },
      new Date(),
    );
    await run("check");
    expect(spotify.calls).toEqual([]);
    expect(await store.getLastRun(thomas)).toBeUndefined();
  });
});
