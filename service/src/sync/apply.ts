// Carries out a plan's actions. It only adds (sync-safety.md). Each change
// is recorded as soon as Spotify takes it, so a run that stops partway, for
// any reason, still remembers what it did.
import type { UserId } from "../ids";
import type { Logger } from "../log";
import { errorFields } from "../log";
import { RateLimited, type SpotifyClient } from "../spotify/client";
import {
  createdPlaylistSchema,
  playlistEntrySchema,
  simpleTrackSchema,
  snapshotSchema,
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

export type Change =
  | { kind: "saved"; albumId: string; key: string }
  | { kind: "followed"; playlistId: string; albumKey: string }
  // A playlist made, before its tracks go in.
  | {
      kind: "made";
      playlistId: string;
      albumId: string;
      albumLabel: string;
      name: string;
    }
  // A playlist spotimy made now holds its album.
  | { kind: "filled"; playlistId: string; verdict: Verdict };

export interface Outcome {
  saved: number;
  followed: number;
  created: { name: string; year: string }[];
  finished: number;
  failed: number;
  // Why it stopped early, if it did.
  stopped:
    | { reason: "rate-limited"; retryAfter: number }
    | { reason: "out-of-time" }
    // The day's allowance of Spotify calls ran out. The rest waits.
    | { reason: "allowance" }
    | null;
}

async function albumTrackUris(
  client: SpotifyClient,
  albumId: string,
): Promise<string[]> {
  const uris: string[] = [];
  for await (const track of client.pages(
    `/albums/${albumId}/tracks?limit=50&market=from_token`,
    simpleTrackSchema,
  )) {
    if (track.is_local !== true) uris.push(track.uri);
  }
  return uris;
}

async function playlistTrackUris(
  client: SpotifyClient,
  playlistId: string,
): Promise<Set<string>> {
  const uris = new Set<string>();
  for await (const entry of client.pages(
    `/playlists/${playlistId}/items?limit=50&market=from_token&additional_types=track`,
    playlistEntrySchema,
  )) {
    const track = entry.item ?? entry.track;
    if (track !== null && track !== undefined) uris.add(track.uri);
  }
  return uris;
}

async function addTracks(
  client: SpotifyClient,
  playlistId: string,
  uris: string[],
  snapshot: string,
): Promise<string> {
  let latest = snapshot;
  for (const batch of chunk(uris, itemsBatch)) {
    latest = (
      await client.post(
        `/playlists/${playlistId}/items`,
        { uris: batch },
        snapshotSchema,
      )
    ).snapshot_id;
  }
  return latest;
}

const filledVerdict = (
  playlistId: string,
  ownerId: UserId,
  snapshot: string,
  album: { id: string; uri: string; label: string; tracks: number },
  matched: number,
): Verdict => ({
  playlistId,
  snapshot,
  ownerId,
  method: "tracks",
  albumId: album.id,
  albumUri: album.uri,
  albumLabel: album.label,
  purity: 1,
  coverage: Math.min(1, matched / Math.max(1, album.tracks)),
  matched,
  albumTracks: album.tracks,
});

export async function applyActions(config: {
  client: SpotifyClient;
  userId: UserId;
  actions: Actions;
  privatePlaylists: boolean;
  // Whether there is time for one more change before the function's limit.
  hasTime: () => boolean;
  // Whether the day's allowance of Spotify calls has room for one more.
  hasCalls: () => boolean;
  // Called once for everything one call to Spotify took.
  record: (changes: Change[]) => Promise<void>;
  log: Logger;
}): Promise<Outcome> {
  const { client, actions, log, userId, record, hasTime, hasCalls } = config;
  const outcome: Outcome = {
    saved: 0,
    followed: 0,
    created: [],
    finished: 0,
    failed: 0,
    stopped: null,
  };

  // Each step runs alone, so one failure costs only its own change. A long
  // wait from Spotify, or the end of the function's time, stops the rest.
  const step = async (
    work: () => Promise<void>,
    size = 1,
  ): Promise<boolean> => {
    if (!hasTime()) {
      outcome.stopped = { reason: "out-of-time" };
      return false;
    }
    if (!hasCalls()) {
      outcome.stopped = { reason: "allowance" };
      return false;
    }
    try {
      await work();
      return true;
    } catch (error) {
      if (error instanceof RateLimited) {
        outcome.stopped = {
          reason: "rate-limited",
          retryAfter: error.retryAfter,
        };
        return false;
      }
      outcome.failed += size;
      log.warn("apply-failed", { userId, ...errorFields(error) });
      return true;
    }
  };

  // Saving an album and following a playlist are the same call.
  const uris = [
    ...actions.save.map((entry) => ({
      uri: entry.uri,
      change: {
        kind: "saved" as const,
        albumId: entry.albumId,
        key: entry.key,
      },
    })),
    ...actions.follow.map((entry) => ({
      uri: `spotify:playlist:${entry.playlistId}`,
      change: {
        kind: "followed" as const,
        playlistId: entry.playlistId,
        albumKey: entry.key,
      },
    })),
  ];
  for (const batch of chunk(uris, libraryBatch)) {
    const going = await step(async () => {
      await client.put(
        `/me/library?uris=${encodeURIComponent(batch.map((entry) => entry.uri).join(","))}`,
      );
      await record(batch.map((entry) => entry.change));
      for (const { change } of batch) {
        if (change.kind === "saved") outcome.saved += 1;
        else outcome.followed += 1;
      }
    }, batch.length);
    if (!going) return outcome;
  }

  for (const entry of actions.finish) {
    const going = await step(async () => {
      const album = await albumTrackUris(client, entry.albumId);
      const present = await playlistTrackUris(client, entry.playlistId);
      const missing = album.filter((uri) => !present.has(uri));
      const snapshot = await addTracks(client, entry.playlistId, missing, "");
      await record([
        {
          kind: "filled",
          playlistId: entry.playlistId,
          verdict: filledVerdict(
            entry.playlistId,
            userId,
            snapshot,
            {
              id: entry.albumId,
              uri: `spotify:album:${entry.albumId}`,
              label: entry.albumLabel,
              tracks: album.length,
            },
            album.length,
          ),
        },
      ]);
      outcome.finished += 1;
    });
    if (!going) return outcome;
  }

  for (const { saved, name } of actions.create) {
    const going = await step(async () => {
      const { album } = saved;
      const tracks = await albumTrackUris(client, album.id);
      if (tracks.length === 0) return;
      const playlist = await client.post(
        "/me/playlists",
        { name, public: !config.privatePlaylists },
        createdPlaylistSchema,
      );
      // Recorded before its tracks go in, so a half-made playlist is
      // finished later rather than left empty.
      await record([
        {
          kind: "made",
          playlistId: playlist.id,
          albumId: album.id,
          albumLabel: label(album),
          name,
        },
      ]);
      const snapshot = await addTracks(
        client,
        playlist.id,
        tracks,
        playlist.snapshot_id,
      );
      const year = saved.added_at.slice(0, 4);
      await record([
        {
          kind: "filled",
          playlistId: playlist.id,
          verdict: filledVerdict(
            playlist.id,
            userId,
            snapshot,
            {
              id: album.id,
              uri: album.uri,
              label: label(album),
              tracks: album.total_tracks,
            },
            tracks.length,
          ),
        },
      ]);
      outcome.created.push({ name, year });
    });
    if (!going) return outcome;
  }
  return outcome;
}
