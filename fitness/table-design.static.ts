import { describe, expect, it } from "vitest";
import { serverless } from "./serverless.ts";

describe("fitness: one table, no index, no scan (table-design.md)", () => {
  it("gives the functions no right to scan", () => {
    const actions = serverless().provider.iam.role.statements.flatMap(
      (statement) => statement.Action,
    );
    expect(
      actions.filter((action) => action.startsWith("dynamodb:")),
    ).not.toContain("dynamodb:Scan");
  });

  it("defines one table, keyed pk and sk, with no secondary index", () => {
    const tables = Object.values(serverless().resources.Resources).filter(
      (resource) => resource.Type === "AWS::DynamoDB::Table",
    );
    expect(tables).toHaveLength(1);
    const properties = tables[0]?.Properties ?? {};
    expect(properties.GlobalSecondaryIndexes).toBeUndefined();
    expect(properties.LocalSecondaryIndexes).toBeUndefined();
    expect(properties.KeySchema).toEqual([
      { AttributeName: "pk", KeyType: "HASH" },
      { AttributeName: "sk", KeyType: "RANGE" },
    ]);
  });
});
