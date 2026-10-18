// Works out what one person's library is missing. It changes nothing, so it
// is pure: the run applies what it returns (sync-safety.md).
import { z } from "zod";
import type { Plan, Settings } from "../../../shared/page-api";
import type { UserId } from "../ids";
import type { PlaylistSummary, SavedAlbum } from "../spotify/schemas";
import { label, nameKeys, norm, playlistName } from "./names";
import { isAlbumish, isWholeAlbum, minCoverage, type Verdict } from "./verdict";

export interface Library {
  userId: UserId;
  playlists: PlaylistSummary[];
  saved: SavedAlbum[];
}

// An album playlist a member owns, which the rest of the group can follow.
export interface GroupPlaylist {
  playlistId: string;
  ownerId: string;
  ownerName: string;
  albumId: string;
  albumLabel: string;
  name: string;
}

// What the library held after the last run, and what the person removed
// since, which no run puts back.
export const memorySchema = z.object({
  savedAlbums: z.array(z.string()),
  playlists: z.array(z.string()),
  ignoredAlbums: z.array(z.string()),
  ignoredPlaylists: z.array(z.string()),
  ignoredPlaylistAlbums: z.array(z.string()),
});

export type Memory = z.infer<typeof memorySchema>;

export interface PlanInput {
  library: Library;
  settings: Settings;
  verdicts: ReadonlyMap<string, Verdict>;
  group: GroupPlaylist[];
  memory: Memory | undefined;
}

export interface Actions {
  // Album URIs to save.
  save: string[];
  follow: GroupPlaylist[];
  create: { saved: SavedAlbum; name: string }[];
}

export interface Planned {
  plan: Plan;
  actions: Actions;
  // The memory to keep if nothing is applied.
  memory: Memory;
}

const minus = (from: Iterable<string>, take: ReadonlySet<string>) =>
  [...from].filter((item) => !take.has(item));

function nextMemory(input: PlanInput): Memory {
  const { library, verdicts, memory } = input;
  const saved = new Set(library.saved.map((entry) => entry.album.id));
  const listed = new Set(library.playlists.map((playlist) => playlist.id));
  if (memory === undefined) {
    return {
      savedAlbums: [...saved],
      playlists: [...listed],
      ignoredAlbums: [],
      ignoredPlaylists: [],
      ignoredPlaylistAlbums: [],
    };
  }
  const removedAlbums = minus(memory.savedAlbums, saved);
  const removedPlaylists = minus(memory.playlists, listed);
  const removedPlaylistAlbums = removedPlaylists.flatMap((id) => {
    const verdict = verdicts.get(id);
    return verdict !== undefined &&
      verdict.albumId !== null &&
      isAlbumish(verdict)
      ? [verdict.albumId]
      : [];
  });
  return {
    savedAlbums: [...saved],
    playlists: [...listed],
    ignoredAlbums: minus(
      new Set([...memory.ignoredAlbums, ...removedAlbums]),
      saved,
    ),
    ignoredPlaylists: minus(
      new Set([...memory.ignoredPlaylists, ...removedPlaylists]),
      listed,
    ),
    ignoredPlaylistAlbums: [
      ...new Set([...memory.ignoredPlaylistAlbums, ...removedPlaylistAlbums]),
    ],
  };
}

const pct = (share: number) => `${String(Math.round(share * 100))}%`;

export function makePlan(input: PlanInput): Planned {
  const { library, settings, verdicts, group } = input;
  const memory = nextMemory(input);
  const ignoredAlbums = new Set(memory.ignoredAlbums);
  const ignoredPlaylists = new Set(memory.ignoredPlaylists);
  const ignoredPlaylistAlbums = new Set(memory.ignoredPlaylistAlbums);

  const savedIds = new Set(library.saved.map((entry) => entry.album.id));
  const savedKeys = new Set(
    library.saved.map((entry) => norm(label(entry.album))),
  );
  const isSaved = (albumId: string, albumLabel: string) =>
    savedIds.has(albumId) || savedKeys.has(norm(albumLabel));

  const listed = new Set(library.playlists.map((playlist) => playlist.id));
  const mine = library.playlists.flatMap((playlist) => {
    const verdict = verdicts.get(playlist.id);
    return verdict === undefined ? [] : [{ playlist, verdict }];
  });

  // An album already has a playlist here if any playlist in the library is
  // mostly that album, or is named after it in either order.
  const coveredIds = new Set<string>();
  const coveredKeys = new Set<string>();
  for (const { playlist, verdict } of mine) {
    if (
      verdict.albumId !== null &&
      verdict.albumLabel !== null &&
      isAlbumish(verdict)
    ) {
      coveredIds.add(verdict.albumId);
      coveredKeys.add(norm(verdict.albumLabel));
    }
    for (const key of nameKeys(playlist.name)) coveredKeys.add(key);
  }
  const isCovered = (albumId: string, albumLabel: string) =>
    coveredIds.has(albumId) || coveredKeys.has(norm(albumLabel));

  const plan: Plan = {
    first: input.memory === undefined,
    save: [],
    follow: [],
    create: [],
    review: [],
    ignored: {
      albums: memory.ignoredAlbums.length,
      playlists: memory.ignoredPlaylists.length,
    },
  };
  const actions: Actions = { save: [], follow: [], create: [] };
  const queued = new Set<string>();

  const save = (
    albumId: string,
    albumUri: string,
    albumLabel: string,
    from: string,
    match: Plan["save"][number]["match"],
  ) => {
    if (queued.has(albumId) || ignoredAlbums.has(albumId)) return;
    if (isSaved(albumId, albumLabel)) return;
    queued.add(albumId);
    plan.save.push({ albumId, label: albumLabel, from, match });
    actions.save.push(albumUri);
  };

  // 1. Album playlists in the library whose album is not saved.
  for (const { playlist, verdict } of mine) {
    const { albumId, albumUri, albumLabel } = verdict;
    if (albumId === null || albumUri === null || albumLabel === null) continue;
    if (!isWholeAlbum(verdict)) continue;
    if (verdict.method === "mosaic" || verdict.method === "unresolved")
      continue;
    save(albumId, albumUri, albumLabel, playlist.name, verdict.method);
  }

  // 2. The group's album playlists this library has none of.
  if (settings.followGroup) {
    for (const shared of group) {
      if (shared.ownerId === library.userId) continue;
      if (listed.has(shared.playlistId)) continue;
      if (ignoredPlaylists.has(shared.playlistId)) continue;
      if (ignoredPlaylistAlbums.has(shared.albumId)) continue;
      if (isCovered(shared.albumId, shared.albumLabel)) continue;
      coveredIds.add(shared.albumId);
      coveredKeys.add(norm(shared.albumLabel));
      plan.follow.push({
        playlistId: shared.playlistId,
        name: shared.name,
        ownerName: shared.ownerName,
      });
      actions.follow.push(shared);
      save(
        shared.albumId,
        `spotify:album:${shared.albumId}`,
        shared.albumLabel,
        shared.name,
        "tracks",
      );
    }
  }

  // 3. Saved albums with no playlist, oldest first so the newest ends up on
  //    top of the library.
  const byAge = [...library.saved].sort((a, b) =>
    a.added_at.localeCompare(b.added_at),
  );
  for (const saved of byAge) {
    const { album } = saved;
    if (isCovered(album.id, label(album))) continue;
    if (ignoredPlaylistAlbums.has(album.id)) continue;
    coveredIds.add(album.id);
    const name = playlistName(album, settings.albumFirst);
    plan.create.push({
      albumId: album.id,
      name,
      year: saved.added_at.slice(0, 4),
    });
    actions.create.push({ saved, name });
  }

  // 4. What was left alone, for the person to look at.
  for (const { playlist, verdict } of mine) {
    if (verdict.method === "mosaic") {
      plan.review.push({
        playlist: playlist.name,
        kind: "mosaic",
        detail: "Its cover shows several albums.",
      });
    } else if (verdict.method === "unresolved") {
      plan.review.push({
        playlist: playlist.name,
        kind: "unresolved",
        detail: "No album matched its name.",
      });
    } else if (isAlbumish(verdict) && !isWholeAlbum(verdict)) {
      plan.review.push({
        playlist: playlist.name,
        kind: "partial",
        detail: `${String(verdict.matched)} of the ${String(verdict.albumTracks)} tracks on ${verdict.albumLabel ?? "its album"}, under ${pct(minCoverage)}.`,
      });
    } else if (!isAlbumish(verdict) && verdict.matched > 0) {
      plan.review.push({
        playlist: playlist.name,
        kind: "mixed",
        detail: `No one album. The most is ${pct(verdict.purity)} from ${verdict.albumLabel ?? "one album"}.`,
      });
    }
  }

  return { plan, actions, memory };
}
