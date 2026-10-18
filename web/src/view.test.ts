import { describe, expect, it } from "vitest";
import type { LastRun, Status } from "../../shared/page-api";
import {
  appliedLine,
  byYear,
  ignoredLine,
  outcomeLine,
  progressLine,
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
  run: {
    state: "idle",
    job: null,
    startedAt: null,
    retryAt: null,
    progress: null,
  },
  last: null,
  outcome: null,
};

const outcome = (
  result: NonNullable<Status["outcome"]>["result"],
  job: NonNullable<Status["outcome"]>["job"] = "check",
  requestedBy: string | null = "matt",
): Status["outcome"] => ({
  runId: "run00000002",
  job,
  requestedBy,
  finishedAt: "2026-10-18T13:00:00Z",
  result,
  retryAt: null,
});

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

  it("tells someone new what to press", () => {
    expect(runLine(base, now)).toBe(
      "Not checked yet. Press Check now to see what spotimy would change.",
    );
  });

  it("shows how far a run has got", () => {
    const running = (progress: Status["run"]["progress"]): Status => ({
      ...base,
      run: { ...base.run, state: "running", job: "check", progress },
    });
    expect(progressLine(running(null))).toBeUndefined();
    expect(progressLine(running({ stage: "reading", done: 1, total: 2 }))).toBe(
      "Reading libraries: 1 of 2.",
    );
    expect(
      progressLine(running({ stage: "identifying", done: 240, total: 1130 })),
    ).toBe("Looking at playlists: 240 of 1,130.");
    expect(
      progressLine(running({ stage: "applying", done: 5, total: 12 })),
    ).toBe("Making changes: 5 of 12.");
    expect(progressLine(base)).toBeUndefined();
  });

  it("says when the last run failed or stopped, until a newer plan replaces it", () => {
    expect(outcomeLine(base, now)).toBeUndefined();
    expect(
      outcomeLine({ ...base, outcome: outcome("finished") }, now),
    ).toBeUndefined();
    expect(outcomeLine({ ...base, outcome: outcome("failed") }, now)).toMatch(
      /^The last check stopped with an error today at \d\d:\d\d\. Press Check now to try again\.$/u,
    );
    expect(outcomeLine({ ...base, outcome: outcome("stopped") }, now)).toBe(
      "The last check stopped before it finished. What it found is kept, so press Check now to carry on.",
    );
    expect(outcomeLine({ ...base, outcome: outcome("paused") }, now)).toBe(
      "Spotify asked spotimy to wait, so the last check stopped early. What it found is kept, so press Check now to carry on.",
    );
    // A check is everyone's, whoever pressed it, and so is the schedule's.
    expect(
      outcomeLine(
        { ...base, outcome: outcome("failed", "schedule", null) },
        now,
      ),
    ).toMatch(/^The last check stopped with an error/u);
    // A plan made after the failure means a later run worked.
    expect(
      outcomeLine(
        {
          ...base,
          last: { ...last(null), madeAt: "2026-10-18T13:30:00Z" },
          outcome: outcome("failed"),
        },
        now,
      ),
    ).toBeUndefined();
    // Nothing to say while a run is going.
    expect(
      outcomeLine(
        {
          ...base,
          run: { ...base.run, state: "running", job: "check" },
          outcome: outcome("failed"),
        },
        now,
      ),
    ).toBeUndefined();
  });

  it("tells only the person who pressed Apply how their apply ended", () => {
    const theirs = (result: NonNullable<Status["outcome"]>["result"]) =>
      outcomeLine(
        { ...base, outcome: outcome(result, "apply", "thomas") },
        now,
      );
    expect(theirs("failed")).toMatch(
      /^Your last apply stopped with an error today at \d\d:\d\d\. What it did is kept, so press Apply these changes to try again\.$/u,
    );
    expect(theirs("stopped")).toBe(
      "Your last apply stopped before it finished. What it did is kept, so press Apply these changes to carry on.",
    );
    expect(theirs("paused")).toBe(
      "Spotify asked spotimy to wait, so your last apply stopped early. What it did is kept, so press Apply these changes to carry on.",
    );
    expect(
      outcomeLine(
        { ...base, outcome: outcome("failed", "apply", "matt") },
        now,
      ),
    ).toBeUndefined();
  });
});
