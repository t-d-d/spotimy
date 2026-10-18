import { randomBytes } from "node:crypto";
import { beforeEach, inject, vi } from "vitest";
import { createTable } from "./dynamodb.ts";

vi.stubEnv("DYNAMODB_ENDPOINT", inject("databaseEndpoint"));

// Each test gets a table of its own: everything the group shares sits under
// one key, so tests would otherwise see each other's items.
beforeEach(async () => {
  const name = `spotimy-${randomBytes(6).toString("hex")}`;
  await createTable(inject("databaseEndpoint"), name);
  vi.stubEnv("TABLE_NAME", name);
});
