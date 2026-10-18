import { z } from "zod";

// Spotify's user ids: letters, digits and a few marks. An id outside this
// shape is refused at sign-in, so every key built from one is safe.
export const userIdSchema = z
  .string()
  .regex(/^[\w.-]{1,128}$/u)
  .brand<"UserId">();

export type UserId = z.infer<typeof userIdSchema>;

// Spotify's base-62 ids for albums, playlists and tracks.
export const spotifyIdSchema = z.string().regex(/^[A-Za-z0-9]{1,64}$/u);

// Each run's own id, carried by its continuations.
export const runIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/u);
