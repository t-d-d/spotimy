import { describe, expect, it } from "vitest";
import { jobOf } from "./worker";

describe("the worker's events", () => {
  it("starts a scheduled run from EventBridge's event", () => {
    const job = jobOf({
      source: "aws.events",
      "detail-type": "Scheduled Event",
      detail: {},
    });
    expect(job).toMatchObject({
      kind: "schedule",
      requestedBy: null,
      hop: 0,
      approved: null,
      carried: null,
    });
  });

  it("carries on a job it was handed", () => {
    const job = {
      kind: "apply",
      requestedBy: "thomas",
      runId: "abcdefgh1234",
      hop: 2,
      approved: "shownrun0001",
      carried: { saved: 3, followed: 1, created: [], finished: 0, failed: 0 },
      skipped: { playlists: ["RCaro"], searchRefusals: 3 },
    };
    expect(jobOf(job)).toEqual(job);
  });

  it("carries on a job from before runs kept what they skipped", () => {
    expect(
      jobOf({
        kind: "check",
        requestedBy: "thomas",
        runId: "abcdefgh1234",
        hop: 1,
        approved: null,
        carried: null,
      }),
    ).toMatchObject({ skipped: null });
  });

  it("refuses anything else", () => {
    expect(jobOf({ kind: "delete-everything" })).toBeUndefined();
    expect(jobOf(undefined)).toBeUndefined();
  });
});
