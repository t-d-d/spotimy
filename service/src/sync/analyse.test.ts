import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { SpotifyError, type SpotifyClient } from "../spotify/client";
import type { PlaylistSummary } from "../spotify/schemas";
import { createNameReader } from "./analyse";

// A client whose searches answer from a list: a status refuses, null
// answers with no albums.
function searching(answers: (number | null)[]) {
  const searched: string[] = [];
  const client: SpotifyClient = {
    get: <T>(path: string, schema: z.ZodType<T>) => {
      searched.push(path);
      const next = answers.shift() ?? null;
      if (next !== null) return Promise.reject(new SpotifyError(next, path));
      return Promise.resolve(
        schema.parse({ albums: { items: [], next: null } }),
      );
    },
    pages: () => {
      throw new Error("Not used.");
    },
    put: () => Promise.reject(new Error("Not used.")),
    post: () => Promise.reject(new Error("Not used.")),
  };
  return { client, searched };
}

const named = (name: string, mosaic = false): PlaylistSummary => ({
  id: `P${String(name.length)}`,
  name,
  snapshot_id: "s1",
  owner: { id: "rich" },
  public: true,
  images: [
    {
      url: mosaic
        ? "https://mosaic.scdn.co/640/abc"
        : "https://i.scdn.co/image/ab67616d0000b273abc",
    },
  ],
});

const album = named("Bully – Lucky For You");
const mix = named("Rich's mix", true);

describe("finding playlists by name", () => {
  it("stops after three refused searches in a row, counting searches rather than playlists", async () => {
    const { client, searched } = searching([400, 400, 400]);
    const refused: number[] = [];
    const read = createNameReader({ searchRefusals: 0 }, (status) => {
      refused.push(status);
    });
    expect(await read(client, album)).toBeUndefined();
    // A mosaic is never searched for, so it does not reset the count.
    expect((await read(client, mix))?.method).toBe("mosaic");
    expect(await read(client, album)).toBeUndefined();
    expect(await read(client, album)).toBeUndefined();
    expect(await read(client, album)).toBeUndefined();
    expect(searched).toHaveLength(3);
    expect(refused).toEqual([400, 400, 400]);
  });

  it("starts the count again after a search Spotify answers", async () => {
    const { client, searched } = searching([
      400,
      400,
      null,
      null,
      null,
      400,
      400,
    ]);
    const read = createNameReader({ searchRefusals: 0 }, () => undefined);
    for (let index = 0; index < 6; index += 1) await read(client, album);
    // Two refused, three tries answered, two refused, three tries answered.
    expect(searched).toHaveLength(10);
  });

  it("stops at once when Spotify refuses search with a 403", async () => {
    const { client, searched } = searching([403]);
    const state = { searchRefusals: 0 };
    const read = createNameReader(state, () => undefined);
    await read(client, album);
    await read(client, album);
    expect(searched).toHaveLength(1);
    // The run carries this on to its next invocation.
    expect(state.searchRefusals).toBeGreaterThanOrEqual(3);
  });

  it("carries on from an earlier invocation's count", async () => {
    const { client, searched } = searching([400, 400]);
    const read = createNameReader({ searchRefusals: 2 }, () => undefined);
    await read(client, album);
    await read(client, album);
    expect(searched).toHaveLength(1);
  });
});
