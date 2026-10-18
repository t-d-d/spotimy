// Carries out a plan's actions. It only adds (sync-safety.md).
import type { UserId } from "../ids";
import type { Logger } from "../log";
import { errorClass } from "../log";
import { RateLimited, type SpotifyClient } from "../spotify/client";
import {
  createdPlaylistSchema,
  simpleTrackSchema,
  snapshotSchema,
  type SavedAlbum,
} from "../spotify/schemas";
import { label } from "./names";
import type { Actions } from "./plan";
import type { Verdict } from "./verdict";

// Spotify's limits per call.
const libraryBatch = 40;
const itemsBatch = 100;

const chunk = <T>(items: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, index * size + size),
  );

export interface Outcome {
  saved: string[];
  followed: string[];
  created: {
    playlistId: string;
    name: string;
    year: string;
    verdict: Verdict;
  }[];
  failed: number;
  // Set when Spotify asked for a long wait, which stops the rest.
  rateLimited: number | null;
}

async function albumTrackUris(
  client: SpotifyClient,
  saved: SavedAlbum,
): Promise<string[]> {
  const { album } = saved;
  const first = album.tracks;
  const uris = (first?.items ?? []).flatMap((track) =>
    track === null || track.is_local === true ? [] : [track.uri],
  );
  const next =
    first === undefined
      ? `/albums/${album.id}/tracks?limit=50&market=from_token`
      : first.next;
  if (next !== null) {
    for await (const track of client.pages(next, simpleTrackSchema)) {
      if (track.is_local !== true) uris.push(track.uri);
    }
  }
  return uris;
}

export async function applyActions(config: {
  client: SpotifyClient;
  userId: UserId;
  actions: Actions;
  privatePlaylists: boolean;
  log: Logger;
}): Promise<Outcome> {
  const { client, actions, log, userId } = config;
  const outcome: Outcome = {
    saved: [],
    followed: [],
    created: [],
    failed: 0,
    rateLimited: null,
  };

  // Saving an album and following a playlist are the same call.
  const uris = [
    ...actions.save.map((uri) => ({ uri, kind: "album" as const })),
    ...actions.follow.map((playlist) => ({
      uri: `spotify:playlist:${playlist.playlistId}`,
      kind: "playlist" as const,
    })),
  ];
  for (const batch of chunk(uris, libraryBatch)) {
    try {
      await client.put(
        `/me/library?uris=${encodeURIComponent(batch.map((entry) => entry.uri).join(","))}`,
      );
      for (const entry of batch) {
        const id = entry.uri.split(":")[2] ?? "";
        if (entry.kind === "album") outcome.saved.push(id);
        else outcome.followed.push(id);
      }
    } catch (error) {
      if (error instanceof RateLimited) {
        outcome.rateLimited = error.retryAfter;
        return outcome;
      }
      outcome.failed += batch.length;
      log.warn("apply-failed", { userId, errorClass: errorClass(error) });
    }
  }

  for (const { saved, name } of actions.create) {
    try {
      const uris = await albumTrackUris(client, saved);
      if (uris.length === 0) continue;
      const playlist = await client.post(
        "/me/playlists",
        { name, public: !config.privatePlaylists },
        createdPlaylistSchema,
      );
      let snapshot = playlist.snapshot_id;
      for (const batch of chunk(uris, itemsBatch)) {
        snapshot = (
          await client.post(
            `/playlists/${playlist.id}/items`,
            { uris: batch },
            snapshotSchema,
          )
        ).snapshot_id;
      }
      outcome.created.push({
        playlistId: playlist.id,
        name,
        year: saved.added_at.slice(0, 4),
        verdict: {
          playlistId: playlist.id,
          snapshot,
          ownerId: userId,
          method: "tracks",
          albumId: saved.album.id,
          albumUri: saved.album.uri,
          albumLabel: label(saved.album),
          purity: 1,
          coverage: Math.min(
            1,
            uris.length / Math.max(1, saved.album.total_tracks),
          ),
          matched: uris.length,
          albumTracks: saved.album.total_tracks,
        },
      });
    } catch (error) {
      if (error instanceof RateLimited) {
        outcome.rateLimited = error.retryAfter;
        return outcome;
      }
      outcome.failed += 1;
      log.warn("apply-failed", { userId, errorClass: errorClass(error) });
    }
  }
  return outcome;
}
