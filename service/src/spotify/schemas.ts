// The parts of Spotify's answers the sync reads, under the field names a
// development-mode app gets since February 2026 (spotify-api.md). Unknown
// fields are dropped.
import { z } from "zod";
import { spotifyIdSchema, userIdSchema } from "../ids";

export const imageSchema = z.object({ url: z.string() });

const imagesSchema = z
  .array(imageSchema.nullable())
  .nullish()
  .transform((images) => (images ?? []).filter((image) => image !== null));

export const artistSchema = z.object({ name: z.string() });

export const simpleTrackSchema = z.object({
  id: z.string().nullable(),
  uri: z.string(),
  type: z.string().optional(),
  is_local: z.boolean().optional(),
});

export const albumSchema = z.object({
  id: spotifyIdSchema,
  uri: z.string(),
  name: z.string(),
  artists: z.array(artistSchema),
  total_tracks: z.number().int().nonnegative(),
  images: imagesSchema,
});

export type Album = z.infer<typeof albumSchema>;

// A local file's track has an album with no id. It is dropped, not refused,
// so one odd track does not stop a playlist being read.
export const trackSchema = simpleTrackSchema.extend({
  album: albumSchema.optional().catch(undefined),
});

export type Track = z.infer<typeof trackSchema>;

// A page's items may hold nulls, for content since removed. An item that
// does not fit is dropped and counted, so one odd item does not stop a run.
export function pageSchema<T>(item: z.ZodType<T>) {
  return z.object({
    items: z.array(z.unknown()).transform((items) => {
      const kept: T[] = [];
      let skipped = 0;
      for (const entry of items) {
        if (entry === null) continue;
        const parsed = item.safeParse(entry);
        if (parsed.success) kept.push(parsed.data);
        else skipped += 1;
      }
      return { kept, skipped };
    }),
    next: z.string().nullable(),
  });
}

export const albumWithTracksSchema = albumSchema.extend({
  tracks: pageSchema(simpleTrackSchema).optional(),
});

export type AlbumWithTracks = z.infer<typeof albumWithTracksSchema>;

export const savedAlbumSchema = z.object({
  added_at: z.string(),
  album: albumWithTracksSchema,
});

export type SavedAlbum = z.infer<typeof savedAlbumSchema>;

export const playlistSummarySchema = z.object({
  id: spotifyIdSchema,
  name: z.string(),
  snapshot_id: z.string(),
  owner: z.object({ id: z.string() }),
  // Only a public playlist can be followed by anyone else.
  public: z.boolean().nullish(),
  images: imagesSchema,
});

export type PlaylistSummary = z.infer<typeof playlistSummarySchema>;

// item is the field's name since February 2026, track before it.
export const playlistEntrySchema = z.object({
  added_at: z.string().nullish(),
  is_local: z.boolean().optional(),
  item: trackSchema.nullish(),
  track: trackSchema.nullish(),
});

export type PlaylistEntry = z.infer<typeof playlistEntrySchema>;

export const meSchema = z.object({
  id: userIdSchema,
  display_name: z.string().nullish(),
});

export const searchSchema = z.object({
  albums: pageSchema(albumSchema).optional(),
});

export const createdPlaylistSchema = z.object({
  id: spotifyIdSchema,
  snapshot_id: z.string(),
});

export const snapshotSchema = z.object({ snapshot_id: z.string() });

export const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().int().positive(),
  scope: z.string().optional(),
});

export type TokenAnswer = z.infer<typeof tokenSchema>;
