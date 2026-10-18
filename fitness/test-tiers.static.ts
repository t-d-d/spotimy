import { describe, expect, it } from "vitest";
import { repoFiles, scripts } from "../test/repo.ts";
import { tiers } from "../test/tiers.ts";

describe("fitness: a test's suffix fixes its tier (test-tiers.md)", () => {
  it("names no test outside the tiers", () => {
    expect(
      repoFiles().filter((path) => /\.spec\.tsx?$|\.test\.tsx$/u.test(path)),
    ).toEqual([]);
  });

  it("holds only static tests in fitness/, besides its helpers", () => {
    const odd = repoFiles().filter(
      (path) =>
        path.startsWith("fitness/") &&
        !path.endsWith(".static.ts") &&
        path !== "fitness/serverless.ts",
    );
    expect(odd).toEqual([]);
  });

  it("runs every tier in the gate except live", () => {
    const gate = scripts().test ?? "";
    for (const tier of tiers) {
      expect(gate.includes(`--project ${tier.name}`)).toBe(tier.inGate);
    }
  });
});
