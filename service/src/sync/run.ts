// One run for the whole group: read every member's library, find what each
// playlist is, then plan for each person and apply where they said to
// (sync-safety.md).
import type { z } from "zod";
import type { Outcome, Plan, Progress } from "../../../shared/page-api";
import type { jobSchema } from "../jobs";
import { errorClass, errorFields, type Logger } from "../log";
import {
  RateLimited,
  SpotifyError,
  type SpotifyClient,
} from "../spotify/client";
import {
  playlistSummarySchema,
  savedAlbumSchema,
  type PlaylistSummary,
} from "../spotify/schemas";
import type { Member, RunState, Store } from "../store/store";
import {
  analyseTracks,
  createFollowedReader,
  createNameReader,
} from "./analyse";
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
type Skipped = NonNullable<Job["skipped"]>;

export type RunResult =
  | { state: "finished" }
  | { state: "continue"; carried: Carried | null; skipped: Skipped }
  | { state: "paused"; retryAt: Date }
  | { state: "busy" }
  | { state: "stopped" };

export interface RunDeps {
  store: Store;
  // undefined when the member has no tokens Spotify still takes. onCall is
  // told of every call the client sends.
  clientFor: (
    member: Member,
    onCall: () => void,
  ) => Promise<SpotifyClient | undefined>;
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
// spotimy's own allowance of Spotify calls a UTC day, for the whole group,
// well under Spotify's own, so a check and an apply always have room. Looking
// at playlists stops once the day's count reaches lookingCalls, and applying
// once it reaches dailyCalls (spotify-api.md).
export const dailyCalls = 1000;
export const lookingCalls = 600;

// The group's calls to Spotify today. Saved as the run goes and when each
// invocation ends. A failed save is logged, never thrown.
class CallCount {
  private saved: number;
  constructor(
    private readonly store: Store,
    private readonly day: string,
    public used: number,
    private readonly onUnsaved: (error: unknown) => void,
  ) {
    this.saved = used;
  }

  count(): void {
    this.used += 1;
  }

  async save(): Promise<void> {
    const unsaved = this.used - this.saved;
    if (unsaved === 0) return;
    try {
      await this.store.addCallsUsed(this.day, unsaved);
      this.saved = this.used;
    } catch (error) {
      this.onUnsaved(error);
    }
  }
}

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
  // How the run ended, for the page. A failed write is logged, never thrown,
  // so it cannot hide the run's own error or keep the group held.
  const ended = async (
    result: Outcome["result"],
    retryAt: Date | null = null,
  ) => {
    try {
      await store.putOutcome({
        runId: job.runId,
        job: job.kind,
        requestedBy: job.requestedBy,
        finishedAt: now().toISOString(),
        result,
        retryAt: retryAt?.toISOString() ?? null,
      });
    } catch (error) {
      log.warn("outcome-unwritten", {
        ...fields,
        errorClass: errorClass(error),
      });
    }
  };
  if (job.hop > maxHops) {
    log.warn("run-failed", { ...fields, errorClass: "TooManyHops" });
    await ended("stopped");
    await store.endRun(job.runId);
    return { state: "stopped" };
  }
  const existing = await store.getRun();
  const resumed = existing?.runId === job.runId ? existing.progress : null;
  const lock: RunState = {
    runId: job.runId,
    job: job.kind,
    requestedBy: job.requestedBy,
    state: "running",
    startedAt:
      existing?.runId === job.runId ? existing.startedAt : now().toISOString(),
    retryAt: null,
    expiresAt: Math.floor(now().getTime() / 1000) + lockSeconds,
    progress: resumed,
  };
  if (!(await store.takeRun(lock, now()))) {
    log.info("run-busy", fields);
    return { state: "busy" };
  }
  log.info(job.hop === 0 ? "run-started" : "run-continued", fields);
  // Left alone until the run ends, so it is handed to the next invocation.
  const skipping: Skipping = {
    playlists: new Set(job.skipped?.playlists ?? []),
    searchRefusals: job.skipped?.searchRefusals ?? 0,
  };
  // Kept if this invocation dies without a word, or its next never comes,
  // so the page says the run stopped. Every ending below replaces it.
  await ended("stopped");
  let calls: CallCount | undefined;
  try {
    const day = now().toISOString().slice(0, 10);
    calls = new CallCount(
      store,
      day,
      await store.getCallsUsed(day),
      (error) => {
        log.warn("calls-unwritten", { ...fields, ...errorFields(error) });
      },
    );
    await work(job, deps, { resumed, skipping, calls });
    await ended("finished");
    await store.endRun(job.runId);
    log.info("run-finished", fields);
    return { state: "finished" };
  } catch (error) {
    if (error instanceof RateLimited) {
      const retryAt = new Date(now().getTime() + error.retryAfter * 1000);
      await ended("paused", retryAt);
      await store.pauseRun(job.runId, retryAt);
      log.warn("run-paused", { ...fields, retryAfter: error.retryAfter });
      return { state: "paused", retryAt };
    }
    if (error instanceof OutOfTime) {
      return {
        state: "continue",
        carried: error.carried,
        skipped: {
          playlists: [...skipping.playlists],
          searchRefusals: skipping.searchRefusals,
        },
      };
    }
    await ended("failed");
    await store.endRun(job.runId);
    log.error("run-failed", { ...fields, ...errorFields(error) });
    throw error;
  } finally {
    await calls?.save();
  }
}

interface Skipping {
  playlists: Set<string>;
  searchRefusals: number;
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

async function work(
  job: Job,
  deps: RunDeps,
  {
    resumed,
    skipping,
    calls,
  }: { resumed: Progress | null; skipping: Skipping; calls: CallCount },
): Promise<void> {
  const { store, log, remainingMs } = deps;
  const fields = { runId: job.runId, job: job.kind };
  // How far the run has got, for the page. Like an ending, a failed write
  // is logged and the run goes on.
  const progress = async (
    stage: Progress["stage"],
    done: number,
    total: number,
  ) => {
    try {
      await store.setProgress(job.runId, { stage, done, total });
    } catch (error) {
      log.warn("progress-unwritten", {
        ...fields,
        errorClass: errorClass(error),
      });
    }
  };

  // 1. Every member's library, read with their own token. A later
  //    invocation of the run reads them again without counting, so the
  //    page's count never goes back.
  const members = await store.listMembers();
  const memberIds = new Set<string>(members.map((member) => member.id));
  const readers: Reader[] = [];
  for (const [index, member] of members.entries()) {
    if (job.hop === 0) await progress("reading", index, members.length);
    const client = await deps.clientFor(member, () => {
      calls.count();
    });
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
  if (job.hop === 0) {
    await progress("reading", members.length, members.length);
  }

  // 2. What each playlist is. A member's own playlist is read with its
  //    owner's token. One owned outside the group is read by name. One
  //    whose owner is a member that spotimy cannot reach this run waits,
  //    since a guess by name would be kept until the playlist changes.
  const verdicts = await store.getVerdicts();
  const pending: Verdict[] = [];
  const flush = async () => {
    await store.putVerdicts(pending.splice(0));
    await calls.save();
  };
  const owners = new Map<string, Reader>(
    readers.map((reader) => [reader.member.id, reader]),
  );
  const followedReader = createFollowedReader((refusal) => {
    log.info("followed-tracks-unreadable", {
      ...fields,
      ...(refusal === undefined ? {} : errorFields(refusal)),
    });
  });
  const nameReader = createNameReader(skipping, (refusal) => {
    log.warn("name-search-refused", { ...fields, ...errorFields(refusal) });
  });
  const seen = new Set<string>();
  const toRead: { reader: Reader; playlist: PlaylistSummary }[] = [];
  for (const reader of readers) {
    for (const playlist of reader.library.playlists) {
      if (seen.has(playlist.id)) continue;
      seen.add(playlist.id);
      if (verdicts.get(playlist.id)?.snapshot === playlist.snapshot_id)
        continue;
      if (skipping.playlists.has(playlist.id)) continue;
      const owner = owners.get(playlist.owner.id);
      if (owner === undefined && memberIds.has(playlist.owner.id)) continue;
      toRead.push({ reader, playlist });
    }
  }
  // Counted against every playlist, so a later invocation counts on from
  // what earlier ones found.
  const known = seen.size - toRead.length;
  let read = 0;
  // What the day's allowance left unread. The daily schedule carries on.
  let unread = new Set<string>();
  try {
    for (const [index, { reader, playlist }] of toRead.entries()) {
      if (read % 10 === 0) {
        await progress("identifying", known + read, seen.size);
      }
      if (calls.used >= lookingCalls) {
        unread = new Set(toRead.slice(index).map((each) => each.playlist.id));
        log.info("allowance-reached", {
          ...fields,
          read,
          playlists: unread.size,
        });
        break;
      }
      if (remainingMs() < reserveMs) throw new OutOfTime(job.carried);
      const owner = owners.get(playlist.owner.id);
      read += 1;
      let verdict: Verdict | undefined;
      try {
        verdict =
          owner === undefined
            ? ((await followedReader(reader.client, playlist)) ??
              (await nameReader(reader.client, playlist)))
            : await analyseTracks(owner.client, playlist);
      } catch (error) {
        // Spotify refused this playlist alone. A 401 is the token's, not the
        // playlist's, and a 5xx is Spotify's.
        if (
          !(error instanceof SpotifyError) ||
          error.status === 401 ||
          error.status >= 500
        ) {
          throw error;
        }
        log.warn("playlist-unreadable", { ...fields, ...errorFields(error) });
      }
      // Not cached, so the next run tries it again. This run leaves it be.
      if (verdict === undefined) {
        skipping.playlists.add(playlist.id);
        continue;
      }
      verdicts.set(playlist.id, verdict);
      pending.push(verdict);
      if (pending.length >= 10) await flush();
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

  // 4. A plan for each person, applied where they said to. Changes are
  //    counted on from an earlier invocation of this run.
  const changes: Counter = {
    done: resumed?.stage === "applying" ? resumed.done : 0,
    write: (done, total) => progress("applying", done, total),
  };
  for (const reader of readers) {
    await planFor(reader, group, verdicts, job, deps, {
      changes,
      calls,
      unread,
    });
  }
}

interface Counter {
  done: number;
  write: (done: number, total: number) => Promise<void>;
}

async function planFor(
  { member, client, library }: Reader,
  group: GroupPlaylist[],
  verdicts: Map<string, Verdict>,
  job: Job,
  deps: RunDeps,
  {
    changes,
    calls,
    unread,
  }: { changes: Counter; calls: CallCount; unread: Set<string> },
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
    unseen: library.playlists.filter((playlist) => unread.has(playlist.id))
      .length,
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
  const total =
    changes.done +
    actions.save.length +
    actions.follow.length +
    actions.create.length +
    actions.finish.length;
  await changes.write(changes.done, total);
  const remember = async (change: Change) => {
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
        // Spotify has the tracks already, so the playlist is still filled.
        try {
          await store.putVerdicts([change.verdict]);
        } catch (error) {
          log.warn("verdict-unwritten", { ...fields, ...errorFields(error) });
        }
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
  };
  // One write of MEMORY for everything a call to Spotify took. A write per
  // change rewrote the same growing item fast enough for DynamoDB to
  // throttle it (#10). A failed write is logged, not thrown: Spotify took
  // these changes, and the run's next write of MEMORY keeps them (#11).
  // Except for a playlist just made, whose tracks must not go in until
  // MEMORY holds it (sync-safety.md).
  const record = async (taken: Change[]) => {
    for (const change of taken) await remember(change);
    try {
      await store.putMemberState(member.id, { memory });
    } catch (error) {
      if (taken.some((change) => change.kind === "made")) throw error;
      log.warn("memory-unwritten", { ...fields, ...errorFields(error) });
    }
    // Counted once Spotify has taken it. A playlist counts when filled.
    const counted = taken.filter((change) => change.kind !== "made").length;
    if (counted > 0) {
      changes.done += counted;
      await changes.write(changes.done, total);
    }
  };

  const outcome = await applyActions({
    client,
    userId: member.id,
    actions,
    privatePlaylists: profile.settings.privatePlaylists,
    hasTime: () => remainingMs() > stepReserveMs,
    hasCalls: () => calls.used < dailyCalls,
    record,
    log,
  });
  await calls.save();
  if (outcome.stopped?.reason === "allowance") {
    log.info("allowance-reached", { ...fields, failed: outcome.failed });
  }
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
        // Also when playlists the person approved were held back, as some
        // of their playlists are still to look at.
        unfinished:
          outcome.stopped !== null ||
          (approved !== undefined &&
            planned.plan.waiting > 0 &&
            approved.create.length + approved.follow.length > 0),
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
