import { describe, expect, it } from "vitest";
import { playlistEntrySchema } from "./schemas";

// A local file in a playlist, as Spotify sends it: no ids, and an album
// that is only a name.
const localEntry = {
  added_at: "2026-10-01T00:00:00Z",
  is_local: true,
  item: {
    id: null,
    uri: "spotify:local:Someone:Something:Track:200",
    type: "track",
    is_local: true,
    album: {
      id: null,
      uri: null,
      name: "Something",
      artists: [],
      images: [],
      album_type: null,
    },
  },
};

const trackEntry = (album: unknown) => ({
  added_at: "2026-10-01T00:00:00Z",
  is_local: false,
  item: {
    id: "T1",
    uri: "spotify:track:T1",
    type: "track",
    is_local: false,
    album,
  },
});

describe("a playlist's items", () => {
  it("reads a local file without its album", () => {
    const entry = playlistEntrySchema.parse(localEntry);
    expect(entry.item?.uri).toBe("spotify:local:Someone:Something:Track:200");
    expect(entry.item?.album).toBeUndefined();
  });

  it("refuses a Spotify track whose album does not fit", () => {
    expect(
      playlistEntrySchema.safeParse(trackEntry({ id: null, name: "Broken" }))
        .success,
    ).toBe(false);
  });

  it("reads a Spotify track's album", () => {
    const entry = playlistEntrySchema.parse(
      trackEntry({
        id: "A1",
        uri: "spotify:album:A1",
        name: "Lucky For You",
        artists: [{ name: "Bully" }],
        total_tracks: 10,
        images: [],
      }),
    );
    expect(entry.item?.album?.id).toBe("A1");
  });
});
