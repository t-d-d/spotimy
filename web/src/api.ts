// The page's calls to the API, parsed with the shared schemas.
import {
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

async function statusFrom(response: Response): Promise<Status> {
  if (response.status === 401) throw new SignedOut();
  if (response.status === 409) throw new Busy();
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

export const startRun = async (kind: "check" | "apply"): Promise<Status> =>
  statusFrom(await fetch(`/api/${kind}`, { method: "POST" }));

export async function signOut(): Promise<void> {
  await fetch("/api/logout", { method: "POST" });
}

export async function leave(): Promise<void> {
  const response = await fetch("/api/leave", { method: "POST" });
  if (!response.ok)
    throw new Error(`The API answered ${String(response.status)}.`);
}
