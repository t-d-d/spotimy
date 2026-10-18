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
  // The person's first plan, which always waits for review.
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
  failed: count,
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

export const statusSchema = z.object({
  user: z.object({ id: z.string(), name: z.string() }),
  members: z.array(z.object({ id: z.string(), name: z.string() })),
  settings: settingsSchema,
  run: z.object({
    state: z.enum(runStates),
    job: z.enum(jobs).nullable(),
    startedAt: z.string().nullable(),
    retryAt: z.string().nullable(),
  }),
  last: lastRunSchema.nullable(),
});

export type Status = z.infer<typeof statusSchema>;

// Why the API refused a request the page made.
export const refusalSchema = z.object({
  error: z.enum(["signed-out", "busy", "invalid", "origin"]),
});
