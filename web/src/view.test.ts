import { describe, expect, it } from "vitest";
import type { LastRun, Status } from "../../shared/page-api";
import {
  appliedLine,
  byYear,
  ignoredLine,
  runLine,
  signInMessage,
} from "./view";

const now = new Date("2026-10-18T14:00:00Z");

const base: Status = {
  user: { id: "thomas", name: "Thomas" },
  members: [],
  settings: {
    autoApply: false,
    followGroup: true,
    albumFirst: false,
    privatePlaylists: false,
  },
  run: { state: "idle", job: null, startedAt: null, retryAt: null },
  last: null,
};

const last = (applied: LastRun["applied"]): LastRun => ({
  runId: "run00000001",
  madeAt: "2026-10-18T05:30:00Z",
  job: "schedule",
  plan: {
    first: false,
    save: [],
    follow: [],
    create: [],
    review: [],
    ignored: { albums: 0, playlists: 0 },
  },
  applied,
});

describe("what the page says", () => {
  it("says what a run is doing", () => {
    expect(runLine(base, now)).toBe("Not checked yet.");
    expect(
      runLine(
        { ...base, run: { ...base.run, state: "running", job: "apply" } },
        now,
      ),
    ).toBe("Applying your changes…");
    expect(
      runLine(
        { ...base, run: { ...base.run, state: "running", job: "check" } },
        now,
      ),
    ).toBe("Checking everyone's libraries…");
    expect(runLine({ ...base, last: last(null) }, now)).toMatch(
      /^Last checked today at/u,
    );
    expect(
      runLine(
        {
          ...base,
          run: {
            ...base.run,
            state: "paused",
            retryAt: "2026-10-18T15:00:00Z",
          },
        },
        now,
      ),
    ).toMatch(
      /^Spotify asked spotimy to wait\. The next run can start today at .+, and picks up where this one stopped\.$/u,
    );
  });

  it("sums up what an apply did", () => {
    expect(appliedLine(last(null), now)).toBeUndefined();
    expect(
      appliedLine(
        last({
          at: "2026-10-18T05:31:00Z",
          saved: 3,
          followed: 1,
          created: [{ name: "x", year: "2026" }],
          failed: 0,
        }),
        now,
      ),
    ).toMatch(/: saved 3 albums, followed 1 playlist, made 1 playlist\.$/u);
    expect(
      appliedLine(
        last({
          at: "2026-10-18T05:31:00Z",
          saved: 0,
          followed: 0,
          created: [],
          failed: 2,
        }),
        now,
      ),
    ).toMatch(
      /nothing needed changing\. 2 changes failed, and the next run tries again\.$/u,
    );
  });

  it("groups new playlists by year, newest first", () => {
    expect(
      byYear([
        { name: "a", year: "2024" },
        { name: "b", year: "2026" },
        { name: "c", year: "2024" },
      ]),
    ).toEqual([
      ["2026", ["b"]],
      ["2024", ["a", "c"]],
    ]);
  });

  it("explains a failed sign-in, and says nothing otherwise", () => {
    expect(signInMessage("not-allowed")).toMatch(/User Management/u);
    expect(signInMessage(null)).toBeUndefined();
    expect(signInMessage("whatever")).toBeUndefined();
  });

  it("counts what the person removed, in plain words", () => {
    expect(ignoredLine({ albums: 0, playlists: 0 })).toBeUndefined();
    expect(ignoredLine({ albums: 1, playlists: 0 })).toBe(
      "1 album you removed stays removed.",
    );
    expect(ignoredLine({ albums: 2, playlists: 1 })).toBe(
      "2 albums and 1 playlist you removed stay removed.",
    );
  });
});
