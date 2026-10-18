import { describe, expect, it } from "vitest";
import { routes } from "../service/src/routes.ts";
import { serverless } from "./serverless.ts";

describe("fitness: every route the API serves is deployed, and no other (hosting.md)", () => {
  it("lists the same routes in serverless.yml and service/src/routes.ts", () => {
    const deployed = (serverless().functions.api?.events ?? []).map(
      (event) => event.httpApi,
    );
    expect([...deployed].sort()).toEqual([...routes].sort());
  });
});
