// The deployed site's address, for the live tier.
import { z } from "zod";

export function siteUrl(): string {
  const url = z.url().safeParse(process.env.SPOTIMY_URL);
  if (!url.success)
    throw new Error("Set SPOTIMY_URL to the deployed page's address.");
  return url.data.replace(/\/$/u, "");
}
