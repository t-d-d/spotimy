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
    finish: [],
    review: [],
    ignored: { albums: 0, playlists: 0 },
  },
  applied,
});

const applied = (
  overrides: Partial<NonNullable<LastRun["applied"]>>,
): NonNullable<LastRun["applied"]> => ({
  at: "2026-10-18T05:31:00Z",
  saved: 0,
  followed: 0,
  created: [],
  finished: 0,
  failed: 0,
  unfinished: false,
  ...overrides,
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
      /^Spotify asked spotimy to wait until today at .+\. What it found so far is kept\.$/u,
    );
  });

  it("sums up what an apply did", () => {
    expect(appliedLine(last(null), now)).toBeUndefined();
    expect(
      appliedLine(
        last(
          applied({
            saved: 3,
            followed: 1,
            created: [{ name: "x", year: "2026" }],
            finished: 2,
          }),
        ),
        now,
      ),
    ).toMatch(
      /: saved 3 albums, followed 1 playlist, made 1 playlist, finished 2 playlists\.$/u,
    );
    expect(appliedLine(last(applied({ failed: 2 })), now)).toMatch(
      /nothing needed changing\. 2 changes failed\. They are in the plan again\.$/u,
    );
    expect(
      appliedLine(last(applied({ saved: 1, unfinished: true })), now),
    ).toMatch(
      /saved 1 album\. Spotify asked spotimy to stop before it was done\. Press Apply again later for the rest\.$/u,
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
