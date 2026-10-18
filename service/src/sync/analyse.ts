// Finds what a playlist is: by its tracks where they can be read, and
// otherwise by its name and cover art (spotify-api.md).
import type { SpotifyClient } from "../spotify/client";
import { SpotifyError } from "../spotify/client";
import {
  playlistEntrySchema,
  searchSchema,
  type Album,
  type PlaylistSummary,
} from "../spotify/schemas";
import { coverHash, isMosaic, label, norm, splitName } from "./names";
import type { Method, Verdict } from "./verdict";

const empty = (playlist: PlaylistSummary, method: Method): Verdict => ({
  playlistId: playlist.id,
  snapshot: playlist.snapshot_id,
  ownerId: playlist.owner.id,
  method,
  albumId: null,
  albumUri: null,
  albumLabel: null,
  purity: 0,
  coverage: 0,
  matched: 0,
  albumTracks: 0,
});

const fromAlbum = (
  playlist: PlaylistSummary,
  album: Album,
  method: Method,
): Verdict => ({
  ...empty(playlist, method),
  albumId: album.id,
  albumUri: album.uri,
  albumLabel: label(album),
  purity: 1,
  coverage: 1,
  matched: album.total_tracks,
  albumTracks: album.total_tracks,
});

// Tracks are grouped by a loose artist-and-album key, not by album id, so a
// re-issued album or a relinked track does not make a whole album look mixed.
export async function analyseTracks(
  client: SpotifyClient,
  playlist: PlaylistSummary,
): Promise<Verdict> {
  interface Group {
    tracks: Set<string>;
    byId: Map<string, { album: Album; count: number }>;
  }
  const groups = new Map<string, Group>();
  const path = `/playlists/${playlist.id}/items?limit=50&market=from_token&additional_types=track`;
  for await (const entry of client.pages(path, playlistEntrySchema)) {
    const track = entry.item ?? entry.track;
    if (track === null || track === undefined) continue;
    if (entry.is_local === true || track.is_local === true) continue;
    if (track.type !== undefined && track.type !== "track") continue;
    const album = track.album;
    if (album === undefined) continue;
    const key = norm(label(album));
    const group: Group = groups.get(key) ?? {
      tracks: new Set(),
      byId: new Map(),
    };
    group.tracks.add(track.id ?? track.uri);
    const byId = group.byId.get(album.id) ?? { album, count: 0 };
    byId.count += 1;
    group.byId.set(album.id, byId);
    groups.set(key, group);
  }
  const all = [...groups.values()];
  const total = all.reduce((sum, group) => sum + group.tracks.size, 0);
  const best = all.sort((a, b) => b.tracks.size - a.tracks.size)[0];
  const main = best
    ? [...best.byId.values()].sort((a, b) => b.count - a.count)[0]
    : undefined;
  if (best === undefined || main === undefined)
    return empty(playlist, "tracks");
  const matched = best.tracks.size;
  return {
    ...empty(playlist, "tracks"),
    albumId: main.album.id,
    albumUri: main.album.uri,
    albumLabel: label(main.album),
    purity: matched / total,
    coverage: Math.min(1, matched / Math.max(1, main.album.total_tracks)),
    matched,
    albumTracks: main.album.total_tracks,
  };
}

const nameMatches = (album: Album, artist: string, title: string): boolean => {
  const names = album.artists.map((each) => norm(each.name));
  const artistMatches =
    names.includes(norm(artist)) || names.join(" ") === norm(artist);
  return artistMatches && norm(album.name) === norm(title);
};

async function searchAlbums(
  client: SpotifyClient,
  query: string,
): Promise<Album[]> {
  const answer = await client.get(
    `/search?type=album&limit=10&market=from_token&q=${encodeURIComponent(query)}`,
    searchSchema,
  );
  return answer.albums?.items.kept ?? [];
}

// For a playlist whose tracks cannot be read. A playlist made from one album
// takes that album's cover, so the cover confirms the match.
export async function identifyByName(
  client: SpotifyClient,
  playlist: PlaylistSummary,
): Promise<Verdict> {
  if (isMosaic(playlist.images)) return empty(playlist, "mosaic");
  const parts = splitName(playlist.name);
  if (parts === undefined) return empty(playlist, "unresolved");
  const first = parts[0].replaceAll('"', "");
  const second = parts[1].replaceAll('"', "");
  const hash = coverHash(playlist.images);
  const tries: { query: string; order?: [string, string] }[] = [
    { query: `album:"${second}" artist:"${first}"`, order: [first, second] },
    { query: `album:"${first}" artist:"${second}"`, order: [second, first] },
    { query: `${first} ${second}` },
  ];
  let byName: Album | undefined;
  for (const { query, order } of tries) {
    const hits = await searchAlbums(client, query);
    const byCover =
      hash === undefined
        ? undefined
        : hits.find((album) => coverHash(album.images) === hash);
    if (byCover !== undefined) return fromAlbum(playlist, byCover, "cover");
    byName ??= hits.find((album) =>
      order === undefined
        ? nameMatches(album, first, second) || nameMatches(album, second, first)
        : nameMatches(album, ...order),
    );
    // With no cover to confirm against, a name match is as good as it gets.
    if (byName !== undefined && hash === undefined) break;
  }
  return byName === undefined
    ? empty(playlist, "unresolved")
    : fromAlbum(playlist, byName, "name");
}

// A development-mode app made since February 2026 cannot read the tracks of
// a playlist its user does not own. One made before may still. This tries,
// and after a refusal, or three empty answers in a row, stops trying for the
// rest of the run. Only the documented /items endpoint is used.
export function createFollowedReader(onUnreadable: () => void) {
  let readable = true;
  let emptyInARow = 0;
  const stop = () => {
    readable = false;
    onUnreadable();
  };
  return async (
    client: SpotifyClient,
    playlist: PlaylistSummary,
  ): Promise<Verdict | undefined> => {
    if (!readable) return undefined;
    let verdict: Verdict;
    try {
      verdict = await analyseTracks(client, playlist);
    } catch (error) {
      if (error instanceof SpotifyError && error.status === 403) {
        stop();
        return undefined;
      }
      // Any other refusal is about this playlist alone.
      if (error instanceof SpotifyError && error.status < 500) return undefined;
      throw error;
    }
    if (verdict.matched > 0) {
      emptyInARow = 0;
      return verdict;
    }
    emptyInARow += 1;
    if (emptyInARow >= 3) stop();
    return undefined;
  };
}
