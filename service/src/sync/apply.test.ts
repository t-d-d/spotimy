import { describe, expect, it } from "vitest";
import { userIdSchema } from "../ids";
import { silentLogger } from "../log";
import type { SpotifyClient } from "../spotify/client";
import { applyActions, type Change } from "./apply";

const thomas = userIdSchema.parse("thomas");

const client = (): SpotifyClient => ({
  get: () => Promise.reject(new Error("not used")),
  // eslint-disable-next-line require-yield
  pages: async function* () {
    await Promise.reject(new Error("not used"));
  },
  put: () => Promise.resolve(),
  post: () => Promise.reject(new Error("not used")),
});

const saves = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    albumId: `album${String(index)}`,
    uri: `spotify:album:album${String(index)}`,
    key: `key${String(index)}`,
  }));

describe("applying a plan", () => {
  it("records what each call to Spotify took in one write, not one per change", async () => {
    const records: Change[][] = [];
    const outcome = await applyActions({
      client: client(),
      userId: thomas,
      actions: { save: saves(80), follow: [], create: [], finish: [] },
      privatePlaylists: false,
      hasTime: () => true,
      hasCalls: () => true,
      record: (changes) => {
        records.push(changes);
        return Promise.resolve();
      },
      log: silentLogger,
    });

    expect(records.map((changes) => changes.length)).toEqual([40, 40]);
    expect(outcome.saved).toBe(80);
    expect(outcome.failed).toBe(0);
  });
});
