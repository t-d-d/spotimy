// One run for the whole group: read every member's library, find what each
// playlist is, then plan for each person and apply where they said to
// (sync-safety.md).
import type { LastRun } from "../../../shared/page-api";
import type { UserId } from "../ids";
import { errorClass, type Logger } from "../log";
import { RateLimited, type SpotifyClient } from "../spotify/client";
import {
  playlistSummarySchema,
  savedAlbumSchema,
  type PlaylistSummary,
} from "../spotify/schemas";
import type { Member, RunState, Store } from "../store/store";
import { createFollowedReader, analyseTracks, identifyByName } from "./analyse";
import { applyActions } from "./apply";
import { makePlan, type GroupPlaylist, type Library } from "./plan";
import { isWholeAlbum, type Verdict } from "./verdict";

export interface Job {
  kind: LastRun["job"];
  // Who asked, for an apply or a check. Nobody, for the schedule.
  requestedBy: UserId | null;
  runId: string;
  // How many times this run has carried on in a fresh invocation.
  hop: number;
}

export type RunResult =
  | { state: "finished" }
  | { state: "continue" }
  | { state: "paused"; retryAt: Date }
  | { state: "busy" }
  | { state: "stopped" };

export interface RunDeps {
  store: Store;
  // undefined when the member has no tokens Spotify still takes.
  clientFor: (member: Member) => Promise<SpotifyClient | undefined>;
  log: Logger;
  now: () => Date;
  remainingMs: () => number;
}

// A run holds the group's lock this long before another may take it.
export const lockSeconds = 16 * 60;
// Time kept back to save progress and hand over to the next invocation.
export const reserveMs = 90_000;
// Each person's apply is started only with this much time left.
export const applyReserveMs = 240_000;
export const maxHops = 12;

const nothingApplied = (at: Date): NonNullable<LastRun["applied"]> => ({
  at: at.toISOString(),
  saved: 0,
  followed: 0,
  created: [],
  failed: 0,
});

class OutOfTime extends Error {
  override name = "OutOfTime";
}

export async function runGroup(job: Job, deps: RunDeps): Promise<RunResult> {
  const { store, log, now } = deps;
  const fields = { runId: job.runId, job: job.kind };
  if (job.hop > maxHops) {
    log.warn("run-failed", { ...fields, errorClass: "TooManyHops" });
    await store.endRun(job.runId);
    return { state: "stopped" };
  }
  const existing = await store.getRun();
  const lock: RunState = {
    runId: job.runId,
    job: job.kind,
    requestedBy: job.requestedBy,
    state: "running",
    startedAt:
      existing?.runId === job.runId ? existing.startedAt : now().toISOString(),
    retryAt: null,
    expiresAt: Math.floor(now().getTime() / 1000) + lockSeconds,
  };
  if (!(await store.takeRun(lock, now()))) {
    log.info("run-busy", fields);
    return { state: "busy" };
  }
  log.info(job.hop === 0 ? "run-started" : "run-continued", fields);
  try {
    const result = await work(job, deps);
    if (result.state === "finished") {
      await store.endRun(job.runId);
      log.info("run-finished", fields);
    }
    return result;
  } catch (error) {
    if (error instanceof RateLimited) {
      const retryAt = new Date(now().getTime() + error.retryAfter * 1000);
      await store.pauseRun(job.runId, retryAt);
      log.warn("run-paused", { ...fields, retryAfter: error.retryAfter });
      return { state: "paused", retryAt };
    }
    if (error instanceof OutOfTime) return { state: "continue" };
    await store.endRun(job.runId);
    log.error("run-failed", { ...fields, errorClass: errorClass(error) });
    throw error;
  }
}

interface Reader {
  member: Member;
  client: SpotifyClient;
  library: Library;
}

async function readLibrary(
  member: Member,
  client: SpotifyClient,
): Promise<Library> {
  const playlists: PlaylistSummary[] = [];
  for await (const playlist of client.pages(
    "/me/playlists?limit=50",
    playlistSummarySchema,
  )) {
    playlists.push(playlist);
  }
  const saved = [];
  for await (const entry of client.pages(
    "/me/albums?limit=50&market=from_token",
    savedAlbumSchema,
  )) {
    saved.push(entry);
  }
  return { userId: member.id, playlists, saved };
}

async function work(job: Job, deps: RunDeps): Promise<RunResult> {
  const { store, log, now, remainingMs } = deps;
  const fields = { runId: job.runId, job: job.kind };

  // 1. Every member's library, read with their own token.
  const readers: Reader[] = [];
  for (const member of await store.listMembers()) {
    const client = await deps.clientFor(member);
    if (client === undefined) continue;
    const library = await readLibrary(member, client);
    readers.push({ member, client, library });
    log.info("library-read", {
      ...fields,
      userId: member.id,
      playlists: library.playlists.length,
      albums: library.saved.length,
    });
  }

  // 2. What each playlist is. A member's own playlist is read with its
  //    owner's token. One owned outside the group is read by name.
  const verdicts = await store.getVerdicts();
  const pending: Verdict[] = [];
  const flush = async () => {
    await store.putVerdicts(pending.splice(0));
  };
  const owners = new Map<string, Reader>(
    readers.map((reader) => [reader.member.id, reader]),
  );
  const followedReader = createFollowedReader(() => {
    log.info("followed-tracks-unreadable", fields);
  });
  const seen = new Set<string>();
  let read = 0;
  try {
    for (const reader of readers) {
      for (const playlist of reader.library.playlists) {
        if (seen.has(playlist.id)) continue;
        seen.add(playlist.id);
        if (verdicts.get(playlist.id)?.snapshot === playlist.snapshot_id)
          continue;
        if (remainingMs() < reserveMs) throw new OutOfTime();
        const owner = owners.get(playlist.owner.id);
        const verdict =
          owner === undefined
            ? ((await followedReader(reader.client, playlist)) ??
              (await identifyByName(reader.client, playlist)))
            : await analyseTracks(owner.client, playlist);
        verdicts.set(playlist.id, verdict);
        pending.push(verdict);
        read += 1;
        if (pending.length >= 25) await flush();
      }
    }
  } finally {
    await flush();
  }
  log.info("playlists-identified", { ...fields, read, playlists: seen.size });

  // 3. The album playlists members own and others can follow.
  const group: GroupPlaylist[] = readers.flatMap(({ member, library }) =>
    library.playlists.flatMap((playlist) => {
      const verdict = verdicts.get(playlist.id);
      if (playlist.owner.id !== member.id || playlist.public === false)
        return [];
      if (verdict === undefined || verdict.method !== "tracks") return [];
      if (!isWholeAlbum(verdict) || verdict.albumId === null) return [];
      return [
        {
          playlistId: playlist.id,
          ownerId: member.id,
          ownerName: member.name,
          albumId: verdict.albumId,
          albumLabel: verdict.albumLabel ?? playlist.name,
          name: playlist.name,
        },
      ];
    }),
  );

  // 4. A plan for each person, applied where they said to.
  for (const { member, client, library } of readers) {
    const profile = await store.getProfile(member.id);
    if (profile === undefined) continue;
    const planned = makePlan({
      library,
      settings: profile.settings,
      verdicts,
      group,
      memory: await store.getMemory(member.id),
    });
    const { plan, actions } = planned;
    log.info("plan-made", {
      ...fields,
      userId: member.id,
      save: plan.save.length,
      follow: plan.follow.length,
      create: plan.create.length,
    });
    const applying =
      (job.kind === "apply" && job.requestedBy === member.id) ||
      (job.kind === "schedule" && profile.settings.autoApply && !plan.first);
    const hasWork =
      actions.save.length + actions.follow.length + actions.create.length > 0;
    const memory = planned.memory;
    if (applying && hasWork) {
      if (remainingMs() < applyReserveMs) throw new OutOfTime();
      const outcome = await applyActions({
        client,
        userId: member.id,
        actions,
        privatePlaylists: profile.settings.privatePlaylists,
        log,
      });
      memory.savedAlbums.push(...outcome.saved);
      memory.playlists.push(
        ...outcome.followed,
        ...outcome.created.map((created) => created.playlistId),
      );
      await store.putVerdicts(
        outcome.created.map((created) => created.verdict),
      );
      for (const created of outcome.created) {
        verdicts.set(created.playlistId, created.verdict);
        // Later members in this run follow it rather than making their own.
        if (
          !profile.settings.privatePlaylists &&
          created.verdict.albumId !== null
        ) {
          group.push({
            playlistId: created.playlistId,
            ownerId: member.id,
            ownerName: member.name,
            albumId: created.verdict.albumId,
            albumLabel: created.verdict.albumLabel ?? created.name,
            name: created.name,
          });
        }
      }
      const applied: LastRun["applied"] = {
        at: now().toISOString(),
        saved: outcome.saved.length,
        followed: outcome.followed.length,
        created: outcome.created.map(({ name, year }) => ({ name, year })),
        failed: outcome.failed,
      };
      log.info("changes-applied", {
        ...fields,
        userId: member.id,
        save: outcome.saved.length,
        follow: outcome.followed.length,
        create: outcome.created.length,
        failed: outcome.failed,
      });
      await store.putMemory(member.id, memory);
      await store.putLastRun(member.id, {
        runId: job.runId,
        madeAt: now().toISOString(),
        job: job.kind,
        plan,
        applied,
      });
      if (outcome.rateLimited !== null)
        throw new RateLimited(outcome.rateLimited);
      continue;
    }
    await store.putMemory(member.id, memory);
    // A run that carried on keeps what its earlier invocation applied.
    const earlier = await store.getLastRun(member.id);
    if (applying && earlier?.runId === job.runId && earlier.applied !== null) {
      continue;
    }
    await store.putLastRun(member.id, {
      runId: job.runId,
      madeAt: now().toISOString(),
      job: job.kind,
      plan,
      applied: applying ? nothingApplied(now()) : null,
    });
  }
  return { state: "finished" };
}
