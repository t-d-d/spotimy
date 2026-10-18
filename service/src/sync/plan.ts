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

// An album is remembered by a loose key of its artist and title as well as
// its id, since the same album often has several editions with their own
// ids. A removal is of the album, whichever edition it was.
export const albumKey = (albumLabel: string): string => norm(albumLabel);

const unfinishedSchema = z.object({
  playlistId: z.string(),
  albumId: z.string(),
  albumLabel: z.string(),
  name: z.string(),
});

export type Unfinished = z.infer<typeof unfinishedSchema>;

// What the library held after the last run, what the person removed since,
// which no run puts back, and whether they have ever applied a plan.
export const memorySchema = z.object({
  reviewed: z.boolean(),
  saved: z.array(z.object({ id: z.string(), key: z.string() })),
  playlists: z.array(
    z.object({ id: z.string(), albumKey: z.string().nullable() }),
  ),
  ignoredAlbumKeys: z.array(z.string()),
  ignoredPlaylists: z.array(z.string()),
  ignoredPlaylistAlbumKeys: z.array(z.string()),
  // Playlists spotimy made whose tracks did not all go in.
  unfinished: z.array(unfinishedSchema),
});

export type Memory = z.infer<typeof memorySchema>;

export const emptyMemory = (): Memory => ({
  reviewed: false,
  saved: [],
  playlists: [],
  ignoredAlbumKeys: [],
  ignoredPlaylists: [],
  ignoredPlaylistAlbumKeys: [],
  unfinished: [],
});

export interface PlanInput {
  library: Library;
  settings: Settings;
  verdicts: ReadonlyMap<string, Verdict>;
  group: GroupPlaylist[];
  memory: Memory | undefined;
}

export interface Actions {
  save: { albumId: string; uri: string; key: string }[];
  follow: (GroupPlaylist & { key: string })[];
  create: { saved: SavedAlbum; name: string; key: string }[];
  finish: Unfinished[];
}

export interface Planned {
  plan: Plan;
  actions: Actions;
  // The memory to keep if nothing is applied.
  memory: Memory;
}

const unique = (items: Iterable<string>) => [...new Set(items)];

function nextMemory(input: PlanInput): Memory {
  const { library, verdicts } = input;
  const previous = input.memory ?? emptyMemory();
  const saved = library.saved.map((entry) => ({
    id: entry.album.id,
    key: albumKey(label(entry.album)),
  }));
  const playlists = library.playlists.map((playlist) => {
    const verdict = verdicts.get(playlist.id);
    return {
      id: playlist.id,
      albumKey:
        verdict !== undefined &&
        verdict.albumLabel !== null &&
        isAlbumish(verdict)
          ? albumKey(verdict.albumLabel)
          : null,
    };
  });
  if (input.memory === undefined) {
    return { ...emptyMemory(), saved, playlists };
  }
  const savedIds = new Set(saved.map((entry) => entry.id));
  const savedKeys = new Set(saved.map((entry) => entry.key));
  const listed = new Set(playlists.map((playlist) => playlist.id));
  const coveredKeys = new Set(
    playlists.flatMap((playlist) =>
      playlist.albumKey === null ? [] : [playlist.albumKey],
    ),
  );
  // Gone by id and by key: swapping one edition for another is not removing.
  const removedAlbumKeys = previous.saved
    .filter((entry) => !savedIds.has(entry.id) && !savedKeys.has(entry.key))
    .map((entry) => entry.key);
  const removedPlaylists = previous.playlists.filter(
    (playlist) => !listed.has(playlist.id),
  );
  return {
    reviewed: previous.reviewed,
    saved,
    playlists,
    ignoredAlbumKeys: unique([
      ...previous.ignoredAlbumKeys,
      ...removedAlbumKeys,
    ]).filter((key) => !savedKeys.has(key)),
    ignoredPlaylists: unique([
      ...previous.ignoredPlaylists,
      ...removedPlaylists.map((playlist) => playlist.id),
    ]).filter((id) => !listed.has(id)),
    ignoredPlaylistAlbumKeys: unique([
      ...previous.ignoredPlaylistAlbumKeys,
      ...removedPlaylists.flatMap((playlist) =>
        playlist.albumKey === null ? [] : [playlist.albumKey],
      ),
    ]).filter((key) => !coveredKeys.has(key)),
    unfinished: previous.unfinished.filter((entry) =>
      listed.has(entry.playlistId),
    ),
  };
}

const pct = (share: number) => `${String(Math.round(share * 100))}%`;

export function makePlan(input: PlanInput): Planned {
  const { library, settings, verdicts, group } = input;
  const memory = nextMemory(input);
  const ignoredAlbums = new Set(memory.ignoredAlbumKeys);
  const ignoredPlaylists = new Set(memory.ignoredPlaylists);
  const ignoredPlaylistAlbums = new Set(memory.ignoredPlaylistAlbumKeys);

  const savedIds = new Set(library.saved.map((entry) => entry.album.id));
  const savedKeys = new Set(
    library.saved.map((entry) => albumKey(label(entry.album))),
  );
  const isSaved = (albumId: string, key: string) =>
    savedIds.has(albumId) || savedKeys.has(key);

  const listed = new Set(library.playlists.map((playlist) => playlist.id));
  const mine = library.playlists.flatMap((playlist) => {
    const verdict = verdicts.get(playlist.id);
    return verdict === undefined ? [] : [{ playlist, verdict }];
  });

  // An album already has a playlist here if any playlist in the library is
  // mostly that album, or is named after it in either order.
  const coveredIds = new Set<string>();
  const coveredKeys = new Set<string>();
  for (const { verdict } of mine) {
    if (
      verdict.albumId !== null &&
      verdict.albumLabel !== null &&
      isAlbumish(verdict)
    ) {
      coveredIds.add(verdict.albumId);
      coveredKeys.add(albumKey(verdict.albumLabel));
    }
  }
  for (const playlist of library.playlists) {
    for (const key of nameKeys(playlist.name)) coveredKeys.add(key);
  }
  const isCovered = (albumId: string, key: string) =>
    coveredIds.has(albumId) || coveredKeys.has(key);
  const cover = (albumId: string, key: string) => {
    coveredIds.add(albumId);
    coveredKeys.add(key);
  };

  const plan: Plan = {
    first: !memory.reviewed,
    save: [],
    follow: [],
    create: [],
    finish: [],
    review: [],
    ignored: {
      albums: memory.ignoredAlbumKeys.length,
      playlists: memory.ignoredPlaylists.length,
    },
  };
  const actions: Actions = { save: [], follow: [], create: [], finish: [] };
  const queued = new Set<string>();

  const save = (
    albumId: string,
    albumUri: string,
    albumLabel: string,
    from: string,
    match: Plan["save"][number]["match"],
  ) => {
    const key = albumKey(albumLabel);
    if (queued.has(key) || ignoredAlbums.has(key)) return;
    if (isSaved(albumId, key)) return;
    queued.add(key);
    plan.save.push({ albumId, label: albumLabel, from, match });
    actions.save.push({ albumId, uri: albumUri, key });
  };

  // 0. Playlists spotimy made and could not fill.
  for (const entry of memory.unfinished) {
    plan.finish.push({ playlistId: entry.playlistId, name: entry.name });
    actions.finish.push(entry);
  }

  // 1. Album playlists in the library whose album is not saved.
  for (const { playlist, verdict } of mine) {
    const { albumId, albumUri, albumLabel } = verdict;
    if (albumId === null || albumUri === null || albumLabel === null) continue;
    if (!isWholeAlbum(verdict)) continue;
    if (verdict.method === "mosaic" || verdict.method === "unresolved")
      continue;
    save(albumId, albumUri, albumLabel, playlist.name, verdict.method);
  }

  // 2. The group's album playlists this library has none of, unless the
  //    person removed the album or a playlist of it.
  if (settings.followGroup) {
    for (const shared of group) {
      const key = albumKey(shared.albumLabel);
      if (shared.ownerId === library.userId) continue;
      if (listed.has(shared.playlistId)) continue;
      if (ignoredPlaylists.has(shared.playlistId)) continue;
      if (ignoredPlaylistAlbums.has(key) || ignoredAlbums.has(key)) continue;
      if (isCovered(shared.albumId, key)) continue;
      cover(shared.albumId, key);
      plan.follow.push({
        playlistId: shared.playlistId,
        name: shared.name,
        ownerName: shared.ownerName,
      });
      actions.follow.push({ ...shared, key });
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
  //    top of the library. Two editions of one album get one playlist.
  const byAge = [...library.saved].sort((a, b) =>
    a.added_at.localeCompare(b.added_at),
  );
  for (const saved of byAge) {
    const { album } = saved;
    const key = albumKey(label(album));
    if (isCovered(album.id, key)) continue;
    if (ignoredPlaylistAlbums.has(key)) continue;
    cover(album.id, key);
    const name = playlistName(album, settings.albumFirst);
    plan.create.push({
      albumId: album.id,
      name,
      year: saved.added_at.slice(0, 4),
    });
    actions.create.push({ saved, name, key });
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

// Keeps only the actions the person saw in the plan they approved. Anything
// new since waits for them to see it (sync-safety.md).
export function approvedOnly(actions: Actions, approved: Plan): Actions {
  const save = new Set(approved.save.map((entry) => entry.albumId));
  const follow = new Set(approved.follow.map((entry) => entry.playlistId));
  const create = new Set(approved.create.map((entry) => entry.albumId));
  const finish = new Set(approved.finish.map((entry) => entry.playlistId));
  return {
    save: actions.save.filter((entry) => save.has(entry.albumId)),
    follow: actions.follow.filter((entry) => follow.has(entry.playlistId)),
    create: actions.create.filter((entry) => create.has(entry.saved.album.id)),
    finish: actions.finish.filter((entry) => finish.has(entry.playlistId)),
  };
}

export const hasActions = (actions: Actions): boolean =>
  actions.save.length +
    actions.follow.length +
    actions.create.length +
    actions.finish.length >
  0;
