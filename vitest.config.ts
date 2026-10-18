import { configDefaults, defineConfig } from "vitest/config";
import { tierPattern, tiers } from "./test/tiers.ts";

const globalSetup: Record<string, string[]> = {
  browser: ["test/page-server.ts"],
  int: ["test/dynamodb.ts"],
};

const setupFiles: Record<string, string[]> = {
  int: ["test/database-env.ts", "test/service-env.ts"],
};

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: [
        "service/src/**/*.ts",
        "shared/**/*.ts",
        "web/src/**/*.{ts,tsx}",
      ],
      // Vitest leaves out only *.test.ts by itself.
      exclude: [...tiers.map(tierPattern), "**/vitest.config.ts"],
      reporter: ["text"],
    },
    projects: tiers.map((tier) => ({
      test: {
        name: tier.name,
        include: [tierPattern(tier)],
        exclude: [...configDefaults.exclude, "**/dist/**"],
        setupFiles: [
          ...(tier.inGate ? ["test/offline.ts"] : []),
          ...(setupFiles[tier.name] ?? []),
        ],
        globalSetup: globalSetup[tier.name] ?? [],
        testTimeout:
          tier.name === "static" || tier.name === "unit" ? 5_000 : 30_000,
      },
    })),
  },
});
