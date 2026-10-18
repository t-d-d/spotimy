import { describe, expect, it } from "vitest";
import { defaultSettings, type Settings } from "../../../shared/page-api";
import { userIdSchema } from "../ids";
import type { PlaylistSummary, SavedAlbum } from "../spotify/schemas";
import {
  albumKey,
  approvedOnly,
  emptyMemory,
  makePlan,
  type GroupPlaylist,
  type Library,
  type Memory,
} from "./plan";
import type { Verdict } from "./verdict";

const thomas = userIdSchema.parse("thomas");

const album = (id: string, artist: string, name: string, tracks = 10) => ({
  id,
  uri: `spotify:album:${id}`,
  name,
  artists: [{ name: artist }],
  total_tracks: tracks,
  images: [],
});

const saved = (
  id: string,
  artist: string,
  name: string,
  addedAt: string,
): SavedAlbum => ({
  added_at: addedAt,
  album: album(id, artist, name),
});

const playlist = (
  id: string,
  name: string,
  ownerId = "thomas",
): PlaylistSummary => ({
  id,
  name,
  snapshot_id: "s1",
  owner: { id: ownerId },
  public: true,
  images: [],
});

const verdict = (
  playlistId: string,
  albumId: string | null,
  albumLabel: string | null,
  overrides: Partial<Verdict> = {},
): Verdict => ({
  playlistId,
  snapshot: "s1",
  ownerId: "thomas",
  method: "tracks",
  albumId,
  albumUri: albumId === null ? null : `spotify:album:${albumId}`,
  albumLabel,
  purity: 1,
  coverage: 1,
  matched: 10,
  albumTracks: 10,
  ...overrides,
});

const memory = (overrides: Partial<Memory> = {}): Memory => ({
  ...emptyMemory(),
  reviewed: true,
  ...overrides,
});

const key = albumKey;

function plan(options: {
  playlists?: PlaylistSummary[];
  saved?: SavedAlbum[];
  verdicts?: Verdict[];
  group?: GroupPlaylist[];
  settings?: Partial<Settings>;
  memory?: Memory | undefined;
}) {
  const library: Library = {
    userId: thomas,
    playlists: options.playlists ?? [],
    saved: options.saved ?? [],
  };
  return makePlan({
    library,
    settings: { ...defaultSettings, ...options.settings },
    verdicts: new Map(
      (options.verdicts ?? []).map((each) => [each.playlistId, each]),
    ),
    group: options.group ?? [],
    memory: "memory" in options ? options.memory : memory(),
  });
}

const shared = (
  playlistId: string,
  albumId: string,
  albumLabel: string,
  ownerId = "matt",
): GroupPlaylist => ({
  playlistId,
  ownerId,
  ownerName: "Matthew",
  albumId,
  albumLabel,
  name: albumLabel,
});

describe("saving the album behind a playlist", () => {
  it("saves the album of a whole-album playlist that is not saved yet", () => {
    const { plan: made, actions } = plan({
      playlists: [playlist("P1", "Bully – Lucky For You")],
      verdicts: [verdict("P1", "A1", "Bully – Lucky For You")],
    });
    expect(made.save).toEqual([
      {
        albumId: "A1",
        label: "Bully – Lucky For You",
        from: "Bully – Lucky For You",
        match: "tracks",
      },
    ]);
    expect(actions.save).toEqual([
      {
        albumId: "A1",
        uri: "spotify:album:A1",
        key: key("Bully – Lucky For You"),
      },
    ]);
  });

  it("does nothing when the album is already saved, by id or by name", () => {
    const { plan: made } = plan({
      playlists: [
        playlist("P1", "Bully – Lucky For You"),
        playlist("P2", "Iceage – Seek Shelter"),
      ],
      verdicts: [
        verdict("P1", "A1", "Bully – Lucky For You"),
        verdict("P2", "A2", "Iceage – Seek Shelter"),
      ],
      saved: [
        saved("A1", "Bully", "Lucky For You", "2024-01-01T00:00:00Z"),
        saved("A2other", "Iceage", "Seek Shelter", "2024-01-01T00:00:00Z"),
      ],
    });
    expect(made.save).toEqual([]);
  });

  it("saves one edition when two playlists hold two editions of an album", () => {
    const { plan: made } = plan({
      playlists: [
        playlist("P1", "Bully – Lucky For You"),
        playlist("P2", "Bully – Lucky For You (copy)"),
      ],
      verdicts: [
        verdict("P1", "A1", "Bully – Lucky For You"),
        verdict("P2", "A1deluxe", "Bully – Lucky For You"),
      ],
    });
    expect(made.save.map((entry) => entry.albumId)).toEqual(["A1"]);
  });

  it("leaves a partial or mixed playlist alone, and lists it for a look", () => {
    const { plan: made } = plan({
      playlists: [playlist("P1", "Bits of Bully"), playlist("P2", "Road trip")],
      verdicts: [
        verdict("P1", "A1", "Bully – Lucky For You", {
          coverage: 0.3,
          matched: 3,
        }),
        verdict("P2", "A2", "Iceage – Seek Shelter", {
          purity: 0.4,
          matched: 2,
        }),
      ],
    });
    expect(made.save).toEqual([]);
    expect(made.review.map((entry) => [entry.playlist, entry.kind])).toEqual([
      ["Bits of Bully", "partial"],
      ["Road trip", "mixed"],
    ]);
  });

  it("marks an album found by name alone", () => {
    const { plan: made } = plan({
      playlists: [playlist("P1", "Bully – Lucky For You", "someone")],
      verdicts: [
        verdict("P1", "A1", "Bully – Lucky For You", { method: "name" }),
      ],
    });
    expect(made.save[0]?.match).toBe("name");
  });

  it("lists a mosaic or an unmatched playlist, and saves nothing for it", () => {
    const { plan: made } = plan({
      playlists: [
        playlist("P1", "Mixtape", "someone"),
        playlist("P2", "Nobody – Nothing", "someone"),
      ],
      verdicts: [
        verdict("P1", null, null, {
          method: "mosaic",
          purity: 0,
          coverage: 0,
          matched: 0,
        }),
        verdict("P2", null, null, {
          method: "unresolved",
          purity: 0,
          coverage: 0,
          matched: 0,
        }),
      ],
    });
    expect(made.save).toEqual([]);
    expect(made.review.map((entry) => entry.kind)).toEqual([
      "mosaic",
      "unresolved",
    ]);
  });
});

describe("making a playlist for a saved album", () => {
  it("makes one for each saved album without a playlist, oldest first", () => {
    const { plan: made, actions } = plan({
      saved: [
        saved("A2", "Iceage", "Seek Shelter", "2026-03-01T00:00:00Z"),
        saved("A1", "Bully", "Lucky For You", "2025-05-01T00:00:00Z"),
      ],
    });
    expect(made.create).toEqual([
      { albumId: "A1", name: "Bully – Lucky For You", year: "2025" },
      { albumId: "A2", name: "Iceage – Seek Shelter", year: "2026" },
    ]);
    expect(actions.create.map((entry) => entry.saved.album.id)).toEqual([
      "A1",
      "A2",
    ]);
  });

  it("makes one playlist when two editions of an album are saved", () => {
    const { plan: made } = plan({
      saved: [
        saved("A1", "Bully", "Lucky For You", "2025-05-01T00:00:00Z"),
        saved("A1deluxe", "Bully", "Lucky For You", "2025-06-01T00:00:00Z"),
      ],
    });
    expect(made.create.map((entry) => entry.albumId)).toEqual(["A1"]);
  });

  it("names it album first when the person asked for that", () => {
    const { plan: made } = plan({
      saved: [saved("A1", "Bully", "Lucky For You", "2025-05-01T00:00:00Z")],
      settings: { albumFirst: true },
    });
    expect(made.create[0]?.name).toBe("Lucky For You – Bully");
  });

  it("counts a playlist named after the album in either order", () => {
    const { plan: made } = plan({
      playlists: [playlist("P1", "Lucky For You – Bully")],
      verdicts: [
        verdict("P1", null, null, { purity: 0, coverage: 0, matched: 0 }),
      ],
      saved: [saved("A1", "Bully", "Lucky For You", "2025-05-01T00:00:00Z")],
    });
    expect(made.create).toEqual([]);
  });

  it("counts a playlist that is mostly the album, even a partial one", () => {
    const { plan: made } = plan({
      playlists: [playlist("P1", "Some Bully")],
      verdicts: [
        verdict("P1", "A1", "Bully – Lucky For You", { coverage: 0.3 }),
      ],
      saved: [saved("A1", "Bully", "Lucky For You", "2025-05-01T00:00:00Z")],
    });
    expect(made.create).toEqual([]);
  });
});

describe("following the group's album playlists", () => {
  it("follows a member's album playlist this library has none of, and saves its album", () => {
    const { plan: made, actions } = plan({
      group: [shared("M1", "B1", "Cable Ties – All Her Plans")],
    });
    expect(made.follow).toEqual([
      {
        playlistId: "M1",
        name: "Cable Ties – All Her Plans",
        ownerName: "Matthew",
      },
    ]);
    expect(actions.follow.map((entry) => entry.playlistId)).toEqual(["M1"]);
    expect(made.save.map((entry) => entry.albumId)).toEqual(["B1"]);
  });

  it("follows nothing when the person turned it off", () => {
    const { plan: made } = plan({
      group: [shared("M1", "B1", "Cable Ties – All Her Plans")],
      settings: { followGroup: false },
    });
    expect(made.follow).toEqual([]);
  });

  it("does not follow a playlist already in the library, or the person's own", () => {
    const { plan: made } = plan({
      playlists: [playlist("M1", "Cable Ties – All Her Plans", "matt")],
      verdicts: [
        verdict("M1", "B1", "Cable Ties – All Her Plans", { ownerId: "matt" }),
      ],
      group: [
        shared("M1", "B1", "Cable Ties – All Her Plans"),
        shared("T1", "B2", "Iceage – Seek Shelter", "thomas"),
      ],
    });
    expect(made.follow).toEqual([]);
  });

  it("does not follow a second playlist for an album the library already has one for", () => {
    const { plan: made } = plan({
      playlists: [playlist("T1", "Cable Ties – All Her Plans")],
      verdicts: [verdict("T1", "B1", "Cable Ties – All Her Plans")],
      group: [shared("M1", "B1", "Cable Ties – All Her Plans")],
    });
    expect(made.follow).toEqual([]);
  });

  it("follows one playlist when two members each own one for the album", () => {
    const { plan: made } = plan({
      group: [
        shared("M1", "B1", "Cable Ties – All Her Plans"),
        shared("R1", "B1", "Cable Ties – All Her Plans", "rich"),
      ],
    });
    expect(made.follow.map((entry) => entry.playlistId)).toEqual(["M1"]);
  });

  it("follows a member's playlist rather than making a new one for a saved album", () => {
    const { plan: made } = plan({
      saved: [
        saved("B1", "Cable Ties", "All Her Plans", "2026-01-01T00:00:00Z"),
      ],
      group: [shared("M1", "B1", "Cable Ties – All Her Plans")],
    });
    expect(made.follow.map((entry) => entry.playlistId)).toEqual(["M1"]);
    expect(made.create).toEqual([]);
    expect(made.save).toEqual([]);
  });
});

describe("what the person removed", () => {
  it("is first until the person has applied once", () => {
    expect(plan({ memory: undefined }).plan.first).toBe(true);
    expect(plan({ memory: memory({ reviewed: false }) }).plan.first).toBe(true);
    expect(plan({}).plan.first).toBe(false);
  });

  it("never saves again an album the person unsaved", () => {
    const { plan: made, memory: next } = plan({
      playlists: [playlist("P1", "Bully – Lucky For You")],
      verdicts: [verdict("P1", "A1", "Bully – Lucky For You")],
      memory: memory({
        saved: [{ id: "A1", key: key("Bully – Lucky For You") }],
        playlists: [{ id: "P1", albumKey: key("Bully – Lucky For You") }],
      }),
    });
    expect(made.save).toEqual([]);
    expect(next.ignoredAlbumKeys).toEqual([key("Bully – Lucky For You")]);
    expect(made.ignored.albums).toBe(1);
  });

  it("never saves another edition of an album the person unsaved", () => {
    const { plan: made } = plan({
      playlists: [playlist("P2", "Bully – Lucky For You (deluxe)", "matt")],
      verdicts: [verdict("P2", "A1deluxe", "Bully – Lucky For You")],
      memory: memory({
        saved: [{ id: "A1", key: key("Bully – Lucky For You") }],
      }),
    });
    expect(made.save).toEqual([]);
  });

  it("does not count swapping one edition for another as a removal", () => {
    const { memory: next } = plan({
      saved: [
        saved("A1deluxe", "Bully", "Lucky For You", "2026-01-01T00:00:00Z"),
      ],
      memory: memory({
        saved: [{ id: "A1", key: key("Bully – Lucky For You") }],
      }),
    });
    expect(next.ignoredAlbumKeys).toEqual([]);
  });

  it("forgets the removal once the person saves the album again", () => {
    const { memory: next } = plan({
      saved: [saved("A1", "Bully", "Lucky For You", "2026-01-01T00:00:00Z")],
      memory: memory({ ignoredAlbumKeys: [key("Bully – Lucky For You")] }),
    });
    expect(next.ignoredAlbumKeys).toEqual([]);
  });

  it("never follows again a playlist the person unfollowed", () => {
    const { plan: made } = plan({
      group: [shared("M1", "B1", "Cable Ties – All Her Plans")],
      memory: memory({
        playlists: [{ id: "M1", albumKey: key("Cable Ties – All Her Plans") }],
      }),
    });
    expect(made.follow).toEqual([]);
    expect(made.ignored.playlists).toBe(1);
  });

  it("does not follow a playlist of an album the person unsaved", () => {
    const { plan: made } = plan({
      group: [shared("M1", "B1", "Cable Ties – All Her Plans")],
      memory: memory({
        saved: [{ id: "B1", key: key("Cable Ties – All Her Plans") }],
      }),
    });
    expect(made.follow).toEqual([]);
  });

  it("never makes a playlist again for an album whose playlist the person removed", () => {
    const { plan: made } = plan({
      saved: [saved("A1", "Bully", "Lucky For You", "2026-01-01T00:00:00Z")],
      memory: memory({
        saved: [{ id: "A1", key: key("Bully – Lucky For You") }],
        playlists: [{ id: "P1", albumKey: key("Bully – Lucky For You") }],
      }),
    });
    expect(made.create).toEqual([]);
  });

  it("does the same when the removed playlist held another edition", () => {
    const { plan: made } = plan({
      saved: [saved("A1", "Bully", "Lucky For You", "2026-01-01T00:00:00Z")],
      memory: memory({
        saved: [{ id: "A1", key: key("Bully – Lucky For You") }],
        playlists: [{ id: "P1", albumKey: key("Bully – Lucky For You") }],
      }),
      verdicts: [verdict("P1", "A1deluxe", "Bully – Lucky For You")],
    });
    expect(made.create).toEqual([]);
  });

  it("keeps what the library holds now as the memory for next time", () => {
    const { memory: next } = plan({
      playlists: [playlist("P1", "Bully – Lucky For You")],
      verdicts: [verdict("P1", "A1", "Bully – Lucky For You")],
      saved: [saved("A1", "Bully", "Lucky For You", "2026-01-01T00:00:00Z")],
      memory: undefined,
    });
    expect(next).toEqual({
      ...emptyMemory(),
      saved: [{ id: "A1", key: key("Bully – Lucky For You") }],
      playlists: [{ id: "P1", albumKey: key("Bully – Lucky For You") }],
    });
  });
});

describe("half-made playlists", () => {
  const unfinished = {
    playlistId: "N1",
    albumId: "A1",
    albumLabel: "Bully – Lucky For You",
    name: "Bully – Lucky For You",
  };

  it("plans to finish a playlist spotimy made and could not fill", () => {
    const { plan: made, actions } = plan({
      playlists: [playlist("N1", "Bully – Lucky For You")],
      saved: [saved("A1", "Bully", "Lucky For You", "2026-01-01T00:00:00Z")],
      memory: memory({ unfinished: [unfinished] }),
    });
    expect(made.finish).toEqual([
      { playlistId: "N1", name: "Bully – Lucky For You" },
    ]);
    expect(actions.finish).toEqual([unfinished]);
    expect(made.create).toEqual([]);
  });

  it("drops it if the person deleted it", () => {
    const { plan: made, memory: next } = plan({
      memory: memory({ unfinished: [unfinished] }),
    });
    expect(made.finish).toEqual([]);
    expect(next.unfinished).toEqual([]);
  });
});

describe("applying only what the person saw", () => {
  it("keeps the actions in the approved plan and drops anything new", () => {
    const now = plan({
      saved: [
        saved("A1", "Bully", "Lucky For You", "2025-05-01T00:00:00Z"),
        saved("A2", "Iceage", "Seek Shelter", "2026-03-01T00:00:00Z"),
      ],
      group: [
        shared("M1", "B1", "Cable Ties – All Her Plans"),
        shared("M2", "B2", "The Smile – Wall of Eyes"),
      ],
    });
    const seen = plan({
      saved: [saved("A1", "Bully", "Lucky For You", "2025-05-01T00:00:00Z")],
      group: [shared("M1", "B1", "Cable Ties – All Her Plans")],
    }).plan;
    const kept = approvedOnly(now.actions, seen);
    expect(kept.create.map((entry) => entry.saved.album.id)).toEqual(["A1"]);
    expect(kept.follow.map((entry) => entry.playlistId)).toEqual(["M1"]);
    expect(kept.save.map((entry) => entry.albumId)).toEqual(["B1"]);
  });
});
