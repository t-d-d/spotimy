// What the page says about a status. Kept out of the components so it can be
// tested in memory.
import type { LastRun, Plan, Status } from "../../shared/page-api";

const time = (iso: string, now: Date): string => {
  const at = new Date(iso);
  const sameDay = at.toDateString() === now.toDateString();
  const clock = at.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return sameDay
    ? `today at ${clock}`
    : `${at.toLocaleDateString("en-GB", { day: "numeric", month: "long" })} at ${clock}`;
};

export function runLine(status: Status, now: Date): string {
  const { run, last } = status;
  if (run.state === "running") {
    return run.job === "apply"
      ? "Applying your changes…"
      : "Checking everyone's libraries…";
  }
  if (run.state === "paused" && run.retryAt !== null) {
    return `Spotify asked spotimy to wait until ${time(run.retryAt, now)}. What it found so far is kept.`;
  }
  if (last === null) {
    return "Not checked yet. Press Check now to see what spotimy would change.";
  }
  return `Last checked ${time(last.madeAt, now)}.`;
}

const counted = (count: number) => count.toLocaleString("en-GB");

// How far the run in progress has got.
export function progressLine(status: Status): string | undefined {
  const { run } = status;
  if (run.state !== "running" || run.progress === null) return undefined;
  const { stage, done, total } = run.progress;
  const what = {
    reading: "Reading libraries",
    identifying: "Looking at playlists",
    applying: "Making changes",
  }[stage];
  return `${what}: ${counted(done)} of ${counted(total)}.`;
}

// Why the last run ended early, until a newer plan shows a later run worked.
// A check is everyone's. An apply is only the person's who pressed Apply.
export function outcomeLine(status: Status, now: Date): string | undefined {
  const { outcome, last, run, user } = status;
  if (outcome === null || run.state !== "idle") return undefined;
  if (outcome.result === "finished") return undefined;
  if (last !== null && last.madeAt > outcome.finishedAt) return undefined;
  if (outcome.job === "apply") {
    if (outcome.requestedBy !== user.id) return undefined;
    switch (outcome.result) {
      case "failed":
        return `Your last apply stopped with an error ${time(outcome.finishedAt, now)}. What it did is kept, so press Apply these changes to try again.`;
      case "stopped":
        return "Your last apply stopped before it finished. What it did is kept, so press Apply these changes to carry on.";
      case "paused":
        return "Spotify asked spotimy to wait, so your last apply stopped early. What it did is kept, so press Apply these changes to carry on.";
    }
  }
  switch (outcome.result) {
    case "failed":
      return `The last check stopped with an error ${time(outcome.finishedAt, now)}. Press Check now to try again.`;
    case "stopped":
      return "The last check stopped before it finished. What it found is kept, so press Check now to carry on.";
    case "paused":
      return "Spotify asked spotimy to wait, so the last check stopped early. What it found is kept, so press Check now to carry on.";
  }
}

export const hasWork = (plan: Plan): boolean =>
  plan.save.length +
    plan.follow.length +
    plan.create.length +
    plan.finish.length >
  0;

const plural = (count: number, one: string, many: string) =>
  `${String(count)} ${count === 1 ? one : many}`;

export function appliedLine(last: LastRun, now: Date): string | undefined {
  const { applied } = last;
  if (applied === null) return undefined;
  const parts = [
    applied.saved > 0
      ? `saved ${plural(applied.saved, "album", "albums")}`
      : "",
    applied.followed > 0
      ? `followed ${plural(applied.followed, "playlist", "playlists")}`
      : "",
    applied.created.length > 0
      ? `made ${plural(applied.created.length, "playlist", "playlists")}`
      : "",
    applied.finished > 0
      ? `finished ${plural(applied.finished, "playlist", "playlists")}`
      : "",
  ].filter((part) => part !== "");
  const done =
    parts.length === 0 ? "nothing needed changing" : parts.join(", ");
  const failed =
    applied.failed > 0
      ? ` ${plural(applied.failed, "change", "changes")} failed. They are in the plan again.`
      : "";
  const unfinished = applied.unfinished
    ? " Spotify asked spotimy to stop before it was done. Press Apply again later for the rest."
    : "";
  return `Applied ${time(applied.at, now)}: ${done}.${failed}${unfinished}`;
}

// New playlists by the year folder each belongs in, newest year first.
export function byYear(
  created: { name: string; year: string }[],
): [string, string[]][] {
  const years = new Map<string, string[]>();
  for (const { name, year } of created)
    years.set(year, [...(years.get(year) ?? []), name]);
  return [...years].sort((a, b) => b[0].localeCompare(a[0]));
}

export function signInMessage(reason: string | null): string | undefined {
  switch (reason) {
    case "not-allowed":
      return "That Spotify account is not on spotimy's list yet. Ask whoever runs spotimy to add it in the Spotify app's User Management.";
    case "cancelled":
      return "Sign-in was cancelled.";
    case "failed":
      return "Sign-in did not work. Try again.";
    case null:
      return undefined;
    default:
      return undefined;
  }
}

// What the person removed, which no run puts back.
export function ignoredLine(ignored: {
  albums: number;
  playlists: number;
}): string | undefined {
  const parts = [
    ignored.albums > 0 ? plural(ignored.albums, "album", "albums") : "",
    ignored.playlists > 0
      ? plural(ignored.playlists, "playlist", "playlists")
      : "",
  ].filter((part) => part !== "");
  if (parts.length === 0) return undefined;
  const one = ignored.albums + ignored.playlists === 1;
  return `${parts.join(" and ")} you removed ${one ? "stays" : "stay"} removed.`;
}
