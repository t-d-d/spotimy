// One run for the whole group: read every member's library, find what each
// playlist is, then plan for each person and apply where they said to
// (sync-safety.md).
import type { z } from "zod";
import type { Plan } from "../../../shared/page-api";
import type { jobSchema } from "../jobs";
import { errorClass, type Logger } from "../log";
import { RateLimited, type SpotifyClient } from "../spotify/client";
import {
  playlistSummarySchema,
  savedAlbumSchema,
  type PlaylistSummary,
} from "../spotify/schemas";
import type { Member, RunState, Store } from "../store/store";
import { analyseTracks, createFollowedReader, identifyByName } from "./analyse";
import { applyActions, type Change } from "./apply";
import {
  albumKey,
  approvedOnly,
  makePlan,
  type Actions,
  type GroupPlaylist,
  type Library,
  type Memory,
} from "./plan";
import { isWholeAlbum, type Verdict } from "./verdict";

export type Job = z.infer<typeof jobSchema>;
type Carried = NonNullable<Job["carried"]>;

export type RunResult =
  | { state: "finished" }
  | { state: "continue"; carried: Carried | null }
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
// Time kept back before reading another playlist, so the run can save what
// it found and hand over to the next invocation.
export const reserveMs = 180_000;
// Time kept back before each change an apply makes.
export const stepReserveMs = 200_000;
export const maxHops = 12;

class OutOfTime extends Error {
  override name = "OutOfTime";
  readonly carried: Carried | null;
  constructor(carried: Carried | null = null) {
    super("The run ran out of time.");
    this.carried = carried;
  }
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
    await work(job, deps);
    await store.endRun(job.runId);
    log.info("run-finished", fields);
    return { state: "finished" };
  } catch (error) {
    if (error instanceof RateLimited) {
      const retryAt = new Date(now().getTime() + error.retryAfter * 1000);
      await store.pauseRun(job.runId, retryAt);
      log.warn("run-paused", { ...fields, retryAfter: error.retryAfter });
      return { state: "paused", retryAt };
    }
    if (error instanceof OutOfTime) {
      return { state: "continue", carried: error.carried };
    }
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

async function work(job: Job, deps: RunDeps): Promise<void> {
  const { store, log, remainingMs } = deps;
  const fields = { runId: job.runId, job: job.kind };

  // 1. Every member's library, read with their own token.
  const members = await store.listMembers();
  const memberIds = new Set<string>(members.map((member) => member.id));
  const readers: Reader[] = [];
  for (const member of members) {
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
  //    owner's token. One owned outside the group is read by name. One
  //    whose owner is a member that spotimy cannot reach this run waits,
  //    since a guess by name would be kept until the playlist changes.
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
        const owner = owners.get(playlist.owner.id);
        if (owner === undefined && memberIds.has(playlist.owner.id)) continue;
        if (remainingMs() < reserveMs) throw new OutOfTime(job.carried);
        const verdict =
          owner === undefined
            ? ((await followedReader(reader.client, playlist)) ??
              (await identifyByName(reader.client, playlist)))
            : await analyseTracks(owner.client, playlist);
        verdicts.set(playlist.id, verdict);
        pending.push(verdict);
        read += 1;
        if (pending.length >= 10) await flush();
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
  for (const reader of readers) {
    await planFor(reader, group, verdicts, job, deps);
  }
}

async function planFor(
  { member, client, library }: Reader,
  group: GroupPlaylist[],
  verdicts: Map<string, Verdict>,
  job: Job,
  deps: RunDeps,
): Promise<void> {
  const { store, log, now, remainingMs } = deps;
  const fields = { runId: job.runId, job: job.kind, userId: member.id };
  const profile = await store.getProfile(member.id);
  if (profile === undefined) return;
  const previous = await store.getLastRun(member.id);
  const planned = makePlan({
    library,
    settings: profile.settings,
    verdicts,
    group,
    memory: await store.getMemory(member.id),
  });
  const { plan, memory } = planned;
  log.info("plan-made", {
    ...fields,
    save: plan.save.length,
    follow: plan.follow.length,
    create: plan.create.length,
  });

  // An apply does what the plan the person approved said, and no more. One
  // that names a plan since replaced does nothing. The schedule applies only
  // for someone who turned that on and has applied once themselves.
  const asked = job.kind === "apply" && job.requestedBy === member.id;
  const approved =
    asked && previous !== undefined && previous.runId === job.approved
      ? previous.plan
      : undefined;
  if (asked && approved === undefined) {
    log.info("apply-refused", fields);
  }
  const automatic =
    job.kind === "schedule" && profile.settings.autoApply && memory.reviewed;
  const actions: Actions | undefined =
    approved !== undefined
      ? approvedOnly(planned.actions, approved)
      : automatic
        ? planned.actions
        : undefined;

  if (actions === undefined) {
    // The person's last apply stays on show until their next one.
    await store.putMemberState(member.id, {
      memory,
      lastRun: {
        runId: job.runId,
        madeAt: now().toISOString(),
        job: job.kind,
        plan,
        applied: previous?.applied ?? null,
      },
    });
    return;
  }

  if (approved !== undefined) memory.reviewed = true;
  const done = {
    saved: new Set<string>(),
    followed: new Set<string>(),
    made: new Map<string, { playlistId: string; name: string }>(),
    filled: new Set<string>(),
  };
  const record = async (change: Change) => {
    switch (change.kind) {
      case "saved":
        done.saved.add(change.albumId);
        memory.saved.push({ id: change.albumId, key: change.key });
        break;
      case "followed":
        done.followed.add(change.playlistId);
        memory.playlists.push({
          id: change.playlistId,
          albumKey: change.albumKey,
        });
        break;
      case "made":
        done.made.set(change.albumId, {
          playlistId: change.playlistId,
          name: change.name,
        });
        memory.playlists.push({
          id: change.playlistId,
          albumKey: albumKey(change.albumLabel),
        });
        memory.unfinished.push({
          playlistId: change.playlistId,
          albumId: change.albumId,
          albumLabel: change.albumLabel,
          name: change.name,
        });
        break;
      case "filled": {
        done.filled.add(change.playlistId);
        memory.unfinished = memory.unfinished.filter(
          (entry) => entry.playlistId !== change.playlistId,
        );
        verdicts.set(change.playlistId, change.verdict);
        await store.putVerdicts([change.verdict]);
        const { albumId, albumLabel } = change.verdict;
        const made = albumId === null ? undefined : done.made.get(albumId);
        // Later members in this run follow it rather than making their own.
        if (
          !profile.settings.privatePlaylists &&
          albumId !== null &&
          albumLabel !== null &&
          made?.playlistId === change.playlistId
        ) {
          group.push({
            playlistId: change.playlistId,
            ownerId: member.id,
            ownerName: member.name,
            albumId,
            albumLabel,
            name: made.name,
          });
        }
        break;
      }
    }
    await store.putMemberState(member.id, { memory });
  };

  const outcome = await applyActions({
    client,
    userId: member.id,
    actions,
    privatePlaylists: profile.settings.privatePlaylists,
    hasTime: () => remainingMs() > stepReserveMs,
    record,
    log,
  });
  const carried: Carried = {
    saved: (job.carried?.saved ?? 0) + outcome.saved,
    followed: (job.carried?.followed ?? 0) + outcome.followed,
    created: [...(job.carried?.created ?? []), ...outcome.created],
    finished: (job.carried?.finished ?? 0) + outcome.finished,
    failed: (job.carried?.failed ?? 0) + outcome.failed,
  };
  log.info("changes-applied", {
    ...fields,
    save: outcome.saved,
    follow: outcome.followed,
    create: outcome.created.length,
    failed: outcome.failed,
  });
  if (outcome.stopped?.reason === "out-of-time") {
    // The approved plan stays as it was, so the next invocation carries on
    // with it. What is done is in the memory already.
    await store.putMemberState(member.id, { memory });
    throw new OutOfTime(carried);
  }
  await store.putMemberState(member.id, {
    memory,
    lastRun: {
      runId: job.runId,
      madeAt: now().toISOString(),
      job: job.kind,
      plan: remaining(plan, done, memory),
      applied: {
        at: now().toISOString(),
        ...carried,
        unfinished: outcome.stopped !== null,
      },
    },
  });
  if (outcome.stopped?.reason === "rate-limited") {
    throw new RateLimited(outcome.stopped.retryAfter);
  }
}

// What is still to do once an apply has run: everything it did not get to,
// and anything new since the plan the person approved.
function remaining(
  plan: Plan,
  done: {
    saved: Set<string>;
    followed: Set<string>;
    made: Map<string, { playlistId: string; name: string }>;
    filled: Set<string>;
  },
  memory: Memory,
): Plan {
  return {
    ...plan,
    first: !memory.reviewed,
    save: plan.save.filter((entry) => !done.saved.has(entry.albumId)),
    follow: plan.follow.filter((entry) => !done.followed.has(entry.playlistId)),
    create: plan.create.filter((entry) => !done.made.has(entry.albumId)),
    finish: memory.unfinished.map((entry) => ({
      playlistId: entry.playlistId,
      name: entry.name,
    })),
  };
}
