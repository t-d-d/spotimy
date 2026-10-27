import { describe, expect, it } from "vitest";
import { deployPath, readRepoFile, readWorkflow } from "../test/repo.ts";
import { serverless } from "./serverless.ts";

describe("fitness: syncing runs in the worker, once per start (hosting.md)", () => {
  it("runs the worker daily, for up to fifteen minutes, never retried by Lambda", () => {
    const worker = serverless().functions.worker;
    expect(worker?.timeout).toBe(900);
    expect(worker?.maximumRetryAttempts).toBe(0);
    expect(worker?.events.some((event) => "schedule" in event)).toBe(true);
  });

  it("keeps the API's requests short", () => {
    expect(serverless().functions.api?.timeout).toBeUndefined();
  });

  it("reads the session key at run time, and names no secret value", () => {
    const yaml = readRepoFile("serverless.yml");
    expect(serverless().provider.environment.SESSION_KEY_PARAMETER).toBe(
      "/spotimy/session-key",
    );
    expect(yaml).not.toMatch(/ssm:\/spotimy\/session-key/u);
  });
});

describe("fitness: one pinned Serverless version (repo-and-delivery.md)", () => {
  it("pins the same version in package.json, serverless.yml and the deploy's checksum step", () => {
    const version = serverless().frameworkVersion;
    expect(readRepoFile("package.json")).toContain(
      `"serverless": "${version}"`,
    );
    const deploy = readRepoFile(".github/workflows/deploy.yml");
    const pinned = [...deploy.matchAll(/version=([\d.]+)/gu)].map(
      (match) => match[1],
    );
    expect(pinned.length).toBeGreaterThan(0);
    expect(new Set(pinned)).toEqual(new Set([version]));
  });
});

describe("fitness: the deploy and the rollback check the same Serverless sums (repo-and-delivery.md)", () => {
  // The rollback repeats the deploy's check. A copy left behind fails only
  // when a rollback runs, during an incident.
  const pinnedSums = (job: string): string[] => {
    const step = readWorkflow(deployPath).jobs[job]?.steps?.find(
      ({ id }) => id === "serverless",
    );
    return [
      ...(step?.run ?? "").matchAll(/^\s*([\da-f]{64}) {2}(\S+)$/gmu),
    ].map(([, sum, file]) => `${sum ?? ""} ${file ?? ""}`);
  };

  it("pins the launcher's and the framework's sums once, in both jobs alike", () => {
    const deploy = pinnedSums("deploy");
    expect(deploy).toHaveLength(2);
    expect(pinnedSums("rollback")).toEqual(deploy);
  });
});
