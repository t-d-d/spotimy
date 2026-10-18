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
    return `Spotify asked spotimy to wait. The next run can start ${time(run.retryAt, now)}, and picks up where this one stopped.`;
  }
  if (last === null) return "Not checked yet.";
  return `Last checked ${time(last.madeAt, now)}.`;
}

export const hasWork = (plan: Plan): boolean =>
  plan.save.length + plan.follow.length + plan.create.length > 0;

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
  ].filter((part) => part !== "");
  const done =
    parts.length === 0 ? "nothing needed changing" : parts.join(", ");
  const failed =
    applied.failed > 0
      ? ` ${plural(applied.failed, "change", "changes")} failed, and the next run tries again.`
      : "";
  return `Applied ${time(applied.at, now)}: ${done}.${failed}`;
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
