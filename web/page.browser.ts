import { describe, expect, it } from "vitest";
import type { Status } from "../shared/page-api";
import { openPage, type ApiCall, type FakeApi } from "../test/browser.ts";

const status = (overrides: Partial<Status> = {}): Status => ({
  user: { id: "thomas", name: "Thomas" },
  members: [
    { id: "thomas", name: "Thomas" },
    { id: "matt", name: "Matthew" },
  ],
  settings: {
    autoApply: false,
    followGroup: true,
    albumFirst: false,
    privatePlaylists: false,
  },
  run: { state: "idle", job: null, startedAt: null, retryAt: null },
  last: {
    runId: "run00000001",
    madeAt: new Date().toISOString(),
    job: "check",
    plan: {
      first: true,
      save: [
        {
          albumId: "A1",
          label: "Bully – Lucky For You",
          from: "Bully – Lucky For You",
          match: "tracks",
        },
        {
          albumId: "A2",
          label: "Caroline Polachek – Desire",
          from: "Caroline Polachek – Desire",
          match: "name",
        },
      ],
      follow: [
        {
          playlistId: "M1",
          name: "The Smile – Wall of Eyes",
          ownerName: "Matthew",
        },
      ],
      create: [
        {
          albumId: "A3",
          name: "Kathryn Joseph – for you who are the wronged",
          year: "2025",
        },
      ],
      finish: [],
      review: [
        { playlist: "Road trip", kind: "mixed", detail: "No one album." },
      ],
      ignored: { albums: 0, playlists: 0 },
    },
    applied: null,
  },
  ...overrides,
});

const answering =
  (
    answers: Partial<Record<string, () => { status: number; body?: unknown }>>,
  ): FakeApi =>
  (call: ApiCall) => {
    const answer = answers[`${call.method} ${call.path}`];
    return answer === undefined ? { status: 404 } : answer();
  };

describe("signed out", () => {
  it("offers sign-in with Spotify", async () => {
    const { page } = await openPage(
      "/",
      answering({
        "GET /api/status": () => ({
          status: 401,
          body: { error: "signed-out" },
        }),
      }),
    );
    const link = page.getByRole("link", { name: "Sign in with Spotify" });
    expect(await link.getAttribute("href")).toBe("/api/login");
  });

  it("says why sign-in did not work when the account is not on the list", async () => {
    const { page } = await openPage(
      "/?signin=not-allowed",
      answering({
        "GET /api/status": () => ({
          status: 401,
          body: { error: "signed-out" },
        }),
      }),
    );
    expect(await page.getByRole("status").textContent()).toContain(
      "not on spotimy's list",
    );
  });
});

describe("signed in", () => {
  it("shows the plan, and says nothing changes until Apply", async () => {
    const { page } = await openPage(
      "/",
      answering({ "GET /api/status": () => ({ status: 200, body: status() }) }),
    );
    await page.getByText("Albums to save (2)").click();
    expect(await page.getByText("matched by name only").count()).toBe(1);
    await page.getByText("Playlists to follow (1)").click();
    expect(await page.getByText("Matthew's").count()).toBe(1);
    await page.getByText("Playlists to make (1)").click();
    expect(
      await page
        .getByText("2025: Kathryn Joseph – for you who are the wronged")
        .count(),
    ).toBe(1);
    expect(
      await page
        .getByText("Nothing changes in your library until you press Apply.")
        .count(),
    ).toBe(1);
  });

  it("starts an apply, then shows the run going", async () => {
    const { page, calls } = await openPage(
      "/",
      answering({
        "GET /api/status": () => ({ status: 200, body: status() }),
        "POST /api/apply": () => ({
          status: 202,
          body: status({
            run: {
              state: "running",
              job: "apply",
              startedAt: new Date().toISOString(),
              retryAt: null,
            },
          }),
        }),
      }),
    );
    await page.getByRole("button", { name: "Apply these changes" }).click();
    await page.getByText("Applying your changes…").waitFor();
    // It names the plan on show, so only what the person saw is applied.
    expect(calls.find((call) => call.path === "/api/apply")?.body).toEqual({
      plan: "run00000001",
    });
    expect(
      await page.getByRole("button", { name: "Check now" }).isDisabled(),
    ).toBe(true);
  });

  it("says so when the plan changed while the page was open", async () => {
    const { page } = await openPage(
      "/",
      answering({
        "GET /api/status": () => ({ status: 200, body: status() }),
        "POST /api/apply": () => ({ status: 409, body: { error: "changed" } }),
      }),
    );
    await page.getByRole("button", { name: "Apply these changes" }).click();
    expect(await page.getByRole("alert").textContent()).toContain(
      "Your plan changed while this page was open.",
    );
  });

  it("asks again while a run goes, and shows the result when it ends", async () => {
    // The run ends a second after the page first asks, so only a poll can
    // show the result.
    let firstAsked: number | undefined;
    const { page } = await openPage(
      "/",
      answering({
        "GET /api/status": () => {
          firstAsked ??= Date.now();
          return Date.now() - firstAsked < 1000
            ? {
                status: 200,
                body: status({
                  run: {
                    state: "running",
                    job: "check",
                    startedAt: new Date().toISOString(),
                    retryAt: null,
                  },
                }),
              }
            : { status: 200, body: status() };
        },
      }),
    );
    await page.getByText("Checking everyone's libraries…").waitFor();
    await page
      .getByText(/^Last checked today at/u)
      .waitFor({ timeout: 10_000 });
  });

  it("saves a changed setting with the rest unchanged", async () => {
    const { page, calls } = await openPage(
      "/",
      answering({
        "GET /api/status": () => ({ status: 200, body: status() }),
        "PUT /api/settings": () => ({
          status: 200,
          body: status({
            settings: {
              autoApply: true,
              followGroup: true,
              albumFirst: false,
              privatePlaylists: false,
            },
          }),
        }),
      }),
    );
    await page
      .getByRole("checkbox", { name: /Apply changes by myself/u })
      .check();
    await expect
      .poll(() => calls.find((call) => call.method === "PUT")?.body)
      .toEqual({
        autoApply: true,
        followGroup: true,
        albumFirst: false,
        privatePlaylists: false,
      });
  });

  it("does not offer Apply when there is nothing to change", async () => {
    const quiet = status();
    if (quiet.last !== null) {
      quiet.last.plan = {
        ...quiet.last.plan,
        save: [],
        follow: [],
        create: [],
        finish: [],
      };
    }
    const { page } = await openPage(
      "/",
      answering({ "GET /api/status": () => ({ status: 200, body: quiet }) }),
    );
    expect(
      await page
        .getByRole("button", { name: "Apply these changes" })
        .isDisabled(),
    ).toBe(true);
    expect(await page.getByText("Nothing to change").count()).toBe(1);
  });
});
