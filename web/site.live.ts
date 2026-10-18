// The deployed site, read only. Spotify's sign-in has no test mode, so the
// live tier never signs in (test-tiers.md).
import { describe, expect, it } from "vitest";
import { siteUrl } from "../test/live.ts";

describe("the deployed site", () => {
  it("serves the page with its security headers", async () => {
    const response = await fetch(`${siteUrl()}/`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("<title>spotimy</title>");
    expect(response.headers.get("content-security-policy")).toContain(
      "default-src 'self'",
    );
    expect(response.headers.get("strict-transport-security")).not.toBeNull();
  });

  it("refuses the API to someone signed out", async () => {
    const response = await fetch(`${siteUrl()}/api/status`);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "signed-out" });
  });

  it("sends sign-in to Spotify, with this site's own callback", async () => {
    const response = await fetch(`${siteUrl()}/api/login`, {
      redirect: "manual",
    });
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.origin).toBe("https://accounts.spotify.com");
    expect(location.searchParams.get("redirect_uri")).toBe(
      `${siteUrl()}/api/callback`,
    );
  });
});
