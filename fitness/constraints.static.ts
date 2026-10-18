import { describe, expect, it } from "vitest";
import { readRepoFile, repoFiles } from "../test/repo.ts";

const files = () =>
  repoFiles().filter(
    (path) =>
      /^docs\/constraints\/.+\.md$/u.test(path) && !path.endsWith("README.md"),
  );

describe("fitness: every constraint file has the same parts (docs/constraints/README.md)", () => {
  it("has a Relevance line, a short Decision, Rules, Do not and History", () => {
    expect(files().length).toBeGreaterThan(0);
    for (const path of files()) {
      const text = readRepoFile(path);
      const decision = /^Decision: (.+)$/mu.exec(text)?.[1] ?? "";
      expect(text, path).toMatch(/^Relevance: .+$/mu);
      expect(decision.length, path).toBeGreaterThan(0);
      expect(decision.length, path).toBeLessThanOrEqual(160);
      expect(text, path).toContain("## Rules");
      expect(text, path).toContain("## Do not");
      expect(text, path).toMatch(/^History: .+$/mu);
    }
  });
});

describe("fitness: plain writing, no em dashes (CLAUDE.md)", () => {
  it("has none in the docs or on the page", () => {
    const prose = repoFiles().filter(
      (path) =>
        (/\.md$/u.test(path) && !path.startsWith(".claude/skills/unslop/")) ||
        /^web\/src\/.+\.tsx$/u.test(path) ||
        path === "web/src/view.ts",
    );
    const dashed = prose.filter((path) => readRepoFile(path).includes("—"));
    expect(dashed).toEqual([]);
  });
});
