import { describe, expect, it } from "vitest";
import type { LastRun, Plan, Status } from "../../shared/page-api";
import {
  appliedLine,
  byYear,
  ignoredLine,
  lastLine,
  outcomeLine,
  progressLine,
  waitingLine,
  signInMessage,
  standing,
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
    waiting: 0,
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
      /saved 1 album\. It stopped before it was done, to stay within Spotify's limits\. Press Apply plan again later for the rest\.$/u,
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
      /^The last update stopped with an error today at \d\d:\d\d\. Press Update plan to try again\.$/u,
    );
    expect(outcomeLine({ ...base, outcome: outcome("stopped") }, now)).toBe(
      "The last update stopped before it finished. What it found is kept, so press Update plan to carry on.",
    );
    expect(outcomeLine({ ...base, outcome: outcome("paused") }, now)).toBe(
      "Spotify asked spotimy to wait, so the last update stopped early. What it found is kept, so press Update plan to carry on.",
    );
    // A check is everyone's, whoever pressed it, and so is the schedule's.
    expect(
      outcomeLine(
        { ...base, outcome: outcome("failed", "schedule", null) },
        now,
      ),
    ).toMatch(/^The last update stopped with an error/u);
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
      /^Your last apply stopped with an error today at \d\d:\d\d\. What it did is kept, so press Apply plan to try again\.$/u,
    );
    expect(theirs("stopped")).toBe(
      "Your last apply stopped before it finished. What it did is kept, so press Apply plan to carry on.",
    );
    expect(theirs("paused")).toBe(
      "Spotify asked spotimy to wait, so your last apply stopped early. What it did is kept, so press Apply plan to carry on.",
    );
    expect(
      outcomeLine(
        { ...base, outcome: outcome("failed", "apply", "matt") },
        now,
      ),
    ).toBeUndefined();
  });

  it("says how many of the person's playlists are still to look at", () => {
    const { plan } = last(null);
    expect(waitingLine(plan)).toBeUndefined();
    expect(waitingLine({ ...plan, waiting: 1530 })).toBe(
      "spotimy has still to look at 1,530 of your playlists. It looks at more each morning, and holds back new and followed playlists until it has seen them all.",
    );
    expect(waitingLine({ ...plan, waiting: 1 })).toBe(
      "spotimy has still to look at 1 of your playlists. It looks at more each morning, and holds back new and followed playlists until it has seen them all.",
    );
  });
});

describe("where things stand", () => {
  const plan = (overrides: Partial<Plan>): Plan => ({
    ...last(null).plan,
    ...overrides,
  });
  const planned = (
    overrides: Partial<Plan>,
    settings: Partial<Status["settings"]> = {},
  ): Status => ({
    ...base,
    settings: { ...base.settings, ...settings },
    last: { ...last(null), plan: plan(overrides) },
  });
  const save = [
    { albumId: "A1", label: "a", from: "a", match: "tracks" as const },
  ];

  it("names the run going, and offers nothing to press", () => {
    expect(
      standing(
        { ...base, run: { ...base.run, state: "running", job: "apply" } },
        now,
      ),
    ).toEqual({
      state: "applying",
      heading: "Applying your plan…",
      next: undefined,
      button: undefined,
    });
    expect(
      standing(
        {
          ...base,
          run: {
            ...base.run,
            state: "running",
            job: "check",
            progress: { stage: "reading", done: 1, total: 2 },
          },
        },
        now,
      ),
    ).toEqual({
      state: "updating",
      heading: "Updating everyone's plans…",
      next: "Reading libraries: 1 of 2.",
      button: undefined,
    });
    // The morning run updates everyone's plans too.
    expect(
      standing(
        { ...base, run: { ...base.run, state: "running", job: "schedule" } },
        now,
      ).state,
    ).toBe("updating");
  });

  it("waits while Spotify asked it to", () => {
    const paused = (retryAt: string | null) =>
      standing(
        {
          ...base,
          run: { ...base.run, state: "paused", job: "check", retryAt },
        },
        now,
      );
    const until = paused("2026-10-18T15:00:00Z");
    expect(until.state).toBe("waiting");
    expect(until.heading).toBe("Waiting for Spotify");
    expect(until.next).toMatch(
      /^Spotify asked spotimy to wait until today at \d\d:\d\d\. What it found so far is kept, and you can carry on after then\.$/u,
    );
    expect(until.button).toBeUndefined();
    expect(paused(null).next).toBe(
      "Spotify asked spotimy to wait. What it found so far is kept.",
    );
  });

  it("says a run stopped, and offers the button that carries on", () => {
    const update = standing({ ...base, outcome: outcome("failed") }, now);
    expect(update).toEqual({
      state: "stopped",
      heading: "Stopped before it finished",
      next: outcomeLine({ ...base, outcome: outcome("failed") }, now),
      button: "update",
    });
    const apply = standing(
      {
        ...planned({ save }),
        outcome: outcome("stopped", "apply", "thomas"),
      },
      now,
    );
    expect(apply.state).toBe("stopped");
    expect(apply.button).toBe("apply");
  });

  it("tells someone new what to press", () => {
    expect(standing(base, now)).toEqual({
      state: "no-plan",
      heading: "No plan yet",
      next: "Press Update plan to see what spotimy would change.",
      button: "update",
    });
  });

  it("offers Apply plan alone when the plan has changes", () => {
    expect(standing(planned({ save }), now)).toEqual({
      state: "ready",
      heading: "Ready to apply",
      next: "Press Apply plan to make these changes.",
      button: "apply",
    });
    // Saves are ready while some playlists are still to look at.
    expect(standing(planned({ save, waiting: 797 }), now).state).toBe("ready");
  });

  it("says the morning run applies the plan once the person has applied once", () => {
    expect(standing(planned({ save }, { autoApply: true }), now).next).toBe(
      "spotimy applies it each morning, or press Apply plan to apply it now.",
    );
    expect(
      standing(planned({ save, first: true }, { autoApply: true }), now).next,
    ).toBe("Press Apply plan to make these changes.");
  });

  it("says it is still looking, and offers nothing to press", () => {
    expect(standing(planned({ waiting: 797 }), now)).toEqual({
      state: "looking",
      heading: "Still looking at your playlists",
      next: "spotimy looks at more each morning and updates your plan.",
      button: undefined,
    });
  });

  it("says when the plan is up to date", () => {
    expect(standing(planned({}), now)).toEqual({
      state: "up-to-date",
      heading: "Up to date",
      next: "spotimy updates your plan each morning, or press Update plan to update it now.",
      button: "update",
    });
  });
});

describe("what the last run did", () => {
  it("says when the plan was updated", () => {
    expect(lastLine(last(null), now)).toMatch(
      /^Plan updated today at \d\d:\d\d\.$/u,
    );
  });

  it("gives the time once when the apply updated the plan", () => {
    const run: LastRun = {
      ...last(applied({ saved: 326, at: "2026-10-18T05:31:40Z" })),
      madeAt: "2026-10-18T05:31:20Z",
    };
    expect(lastLine(run, now)).toBe(appliedLine(run, now));
    expect(lastLine(run, now)).toMatch(
      /^Applied today at \d\d:\d\d: saved 326 albums\.$/u,
    );
  });

  it("gives both when the apply came before the plan", () => {
    expect(
      lastLine(
        {
          ...last(applied({ saved: 1, at: "2026-10-17T20:20:00Z" })),
          madeAt: "2026-10-18T05:30:00Z",
        },
        now,
      ),
    ).toMatch(
      /^Plan updated today at \d\d:\d\d\. Applied 17 October at \d\d:\d\d: saved 1 album\.$/u,
    );
  });
});
