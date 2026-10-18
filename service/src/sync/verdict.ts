// What a playlist was found to be, cached under GROUP by its snapshot.
import { z } from "zod";
import { spotifyIdSchema } from "../ids";

// tracks: its tracks were read. cover: its name was searched and its cover
// art matched. name: its name matched an album exactly, and its cover did
// not confirm it. mosaic: its cover shows several albums. unresolved: no
// album matched.
export const methods = [
  "tracks",
  "cover",
  "name",
  "mosaic",
  "unresolved",
] as const;

export type Method = (typeof methods)[number];

export const verdictSchema = z.object({
  playlistId: spotifyIdSchema,
  snapshot: z.string(),
  ownerId: z.string(),
  method: z.enum(methods),
  albumId: spotifyIdSchema.nullable(),
  albumUri: z.string().nullable(),
  albumLabel: z.string().nullable(),
  // Share of the playlist's tracks from its main album.
  purity: z.number().min(0).max(1),
  // Share of that album's tracks the playlist holds.
  coverage: z.number().min(0).max(1),
  matched: z.number().int().nonnegative(),
  albumTracks: z.number().int().nonnegative(),
});

export type Verdict = z.infer<typeof verdictSchema>;

export const minPurity = 0.8;
export const minCoverage = 0.6;

// Mostly one album.
export const isAlbumish = (verdict: Verdict): boolean =>
  verdict.albumId !== null && verdict.purity >= minPurity;

// Mostly one album, and most of it.
export const isWholeAlbum = (verdict: Verdict): boolean =>
  isAlbumish(verdict) && verdict.coverage >= minCoverage;
