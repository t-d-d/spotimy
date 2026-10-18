// The page's calls to the API, parsed with the shared schemas.
import {
  refusalSchema,
  statusSchema,
  type Settings,
  type Status,
} from "../../shared/page-api";

export class SignedOut extends Error {
  override name = "SignedOut";
}

export class Busy extends Error {
  override name = "Busy";
}

// The plan changed since the page showed it.
export class Changed extends Error {
  override name = "Changed";
}

async function statusFrom(response: Response): Promise<Status> {
  if (response.status === 401) throw new SignedOut();
  if (response.status === 409) {
    const refusal = refusalSchema.safeParse(await response.json());
    throw refusal.success && refusal.data.error === "changed"
      ? new Changed()
      : new Busy();
  }
  if (!response.ok)
    throw new Error(`The API answered ${String(response.status)}.`);
  return statusSchema.parse(await response.json());
}

export const getStatus = async (): Promise<Status> =>
  statusFrom(await fetch("/api/status", { cache: "no-store" }));

export const saveSettings = async (settings: Settings): Promise<Status> =>
  statusFrom(
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(settings),
    }),
  );

export const startCheck = async (): Promise<Status> =>
  statusFrom(await fetch("/api/check", { method: "POST" }));

// Names the plan on show, so only what the person saw is applied.
export const startApply = async (plan: string): Promise<Status> =>
  statusFrom(
    await fetch("/api/apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plan }),
    }),
  );

export async function signOut(): Promise<void> {
  await fetch("/api/logout", { method: "POST" });
}

export async function leave(): Promise<void> {
  const response = await fetch("/api/leave", { method: "POST" });
  if (!response.ok)
    throw new Error(`The API answered ${String(response.status)}.`);
}
