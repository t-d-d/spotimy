import { describe, expect, it } from "vitest";
import { userIdSchema } from "./ids";
import {
  clearCookie,
  createSessions,
  sessionSeconds,
  setCookie,
} from "./session";

const key = "a-test-key-that-is-long-enough-to-sign-with";
const thomas = userIdSchema.parse("thomas");

function sessionsAt(at: Date, withKey = key) {
  return createSessions({ key: () => Promise.resolve(withKey), now: () => at });
}

describe("sessions", () => {
  const start = new Date("2026-10-18T12:00:00Z");

  it("signs a session and reads it back", async () => {
    const sessions = sessionsAt(start);
    expect(
      await sessions.verifySession(await sessions.signSession(thomas)),
    ).toBe("thomas");
  });

  it("refuses a session once it has expired", async () => {
    const token = await sessionsAt(start).signSession(thomas);
    const later = new Date(start.getTime() + (sessionSeconds + 60) * 1000);
    expect(await sessionsAt(later).verifySession(token)).toBeUndefined();
  });

  it("refuses a session signed with another key", async () => {
    const token = await sessionsAt(start, `${key}-other`).signSession(thomas);
    expect(await sessionsAt(start).verifySession(token)).toBeUndefined();
  });

  it("refuses a sign-in token as a session, and the reverse", async () => {
    const sessions = sessionsAt(start);
    const login = await sessions.signLogin({
      state: "s".repeat(32),
      verifier: "v".repeat(64),
    });
    expect(await sessions.verifySession(login)).toBeUndefined();
    expect(
      await sessions.verifyLogin(await sessions.signSession(thomas)),
    ).toBeUndefined();
    expect(await sessions.verifyLogin(login)).toEqual({
      state: "s".repeat(32),
      verifier: "v".repeat(64),
    });
  });

  it("refuses rubbish and nothing", async () => {
    const sessions = sessionsAt(start);
    expect(await sessions.verifySession("not.a.token")).toBeUndefined();
    expect(await sessions.verifySession(undefined)).toBeUndefined();
  });

  it("sets cookies the browser keeps to this site and hides from scripts", () => {
    expect(setCookie("__Host-session", "x", 60)).toBe(
      "__Host-session=x; Max-Age=60; Path=/; HttpOnly; Secure; SameSite=Lax",
    );
    expect(clearCookie("__Host-session")).toContain("Max-Age=0");
  });
});
