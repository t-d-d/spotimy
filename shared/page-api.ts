// What the page and the API say to each other. Both sides parse with these
// schemas, and neither imports the other (types-and-lint.md).
import { z } from "zod";

const count = z.number().int().nonnegative();

export const settingsSchema = z.object({
  // Apply each daily plan without waiting for a press of Apply.
  autoApply: z.boolean(),
  // Follow the album playlists the rest of the group owns.
  followGroup: z.boolean(),
  // Name new playlists "Album – Artist" rather than "Artist – Album".
  albumFirst: z.boolean(),
  // Make new playlists private. The group can only follow public ones.
  privatePlaylists: z.boolean(),
});

export type Settings = z.infer<typeof settingsSchema>;

export const defaultSettings: Settings = {
  autoApply: false,
  followGroup: true,
  albumFirst: false,
  privatePlaylists: false,
};

export const matches = ["tracks", "cover", "name"] as const;
export const reviewKinds = [
  "partial",
  "mixed",
  "mosaic",
  "unresolved",
] as const;

export const planSchema = z.object({
  // True until the person has pressed Apply once. Until then nothing is
  // applied for them without that press.
  first: z.boolean(),
  save: z.array(
    z.object({
      albumId: z.string(),
      label: z.string(),
      // The playlist that led to it.
      from: z.string(),
      match: z.enum(matches),
    }),
  ),
  follow: z.array(
    z.object({
      playlistId: z.string(),
      name: z.string(),
      ownerName: z.string(),
    }),
  ),
  create: z.array(
    z.object({
      albumId: z.string(),
      name: z.string(),
      // The year the album was saved, which names its folder.
      year: z.string(),
    }),
  ),
  // Playlists spotimy made whose tracks did not all go in.
  finish: z.array(z.object({ playlistId: z.string(), name: z.string() })),
  review: z.array(
    z.object({
      playlist: z.string(),
      kind: z.enum(reviewKinds),
      detail: z.string(),
    }),
  ),
  // What the person removed, which no run puts back.
  ignored: z.object({ albums: count, playlists: count }),
});

export type Plan = z.infer<typeof planSchema>;

export const appliedSchema = z.object({
  at: z.string(),
  saved: count,
  followed: count,
  created: z.array(z.object({ name: z.string(), year: z.string() })),
  finished: count,
  failed: count,
  // Spotify asked spotimy to stop before it was done.
  unfinished: z.boolean(),
});

export type Applied = z.infer<typeof appliedSchema>;

export const jobs = ["schedule", "check", "apply"] as const;

export const lastRunSchema = z.object({
  runId: z.string(),
  madeAt: z.string(),
  job: z.enum(jobs),
  plan: planSchema,
  applied: appliedSchema.nullable(),
});

export type LastRun = z.infer<typeof lastRunSchema>;

export const runStates = ["idle", "running", "paused"] as const;

// How far a run in progress has got, so the page can show it moving.
export const progressSchema = z.object({
  stage: z.enum(["reading", "identifying", "applying"]),
  done: count,
  total: count,
});

export type Progress = z.infer<typeof progressSchema>;

// How the group's last run ended, so a run that failed or stopped early is
// not silent. A run that dies without a word is left as stopped. An apply's
// ending is for the person who pressed Apply.
export const outcomeSchema = z.object({
  runId: z.string(),
  job: z.enum(jobs),
  requestedBy: z.string().nullable(),
  finishedAt: z.string(),
  result: z.enum(["finished", "failed", "paused", "stopped"]),
  retryAt: z.string().nullable(),
});

export type Outcome = z.infer<typeof outcomeSchema>;

export const statusSchema = z.object({
  user: z.object({ id: z.string(), name: z.string() }),
  members: z.array(z.object({ id: z.string(), name: z.string() })),
  settings: settingsSchema,
  run: z.object({
    state: z.enum(runStates),
    job: z.enum(jobs).nullable(),
    startedAt: z.string().nullable(),
    retryAt: z.string().nullable(),
    // Defaults, so the page still reads an older API during a rollback.
    progress: progressSchema.nullable().default(null),
  }),
  last: lastRunSchema.nullable(),
  outcome: outcomeSchema.nullable().default(null),
});

export type Status = z.infer<typeof statusSchema>;

// Why the API refused a request the page made.
// An apply names the plan the person saw, by the run that made it, so a plan
// that changed since is not applied unseen (sync-safety.md).
export const applyRequestSchema = z.object({ plan: z.string().min(1) });

export const refusals = [
  "signed-out",
  "busy",
  "changed",
  "invalid",
  "origin",
] as const;

export const refusalSchema = z.object({ error: z.enum(refusals) });

export type Refusal = (typeof refusals)[number];
