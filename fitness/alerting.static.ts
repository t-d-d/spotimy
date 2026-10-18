import { describe, expect, it } from "vitest";
import { serverless } from "./serverless.ts";

const capitalised = (name: string) =>
  `${name.charAt(0).toUpperCase()}${name.slice(1)}`;

describe("fitness: every function's error lines are counted (alerting.md)", () => {
  it("has an error-lines metric filter on each function's log group", () => {
    const { functions, resources } = serverless();
    const filtered = Object.values(resources.Resources)
      .filter((resource) => resource.Type === "AWS::Logs::MetricFilter")
      .map((resource) => JSON.stringify(resource.Properties?.LogGroupName));
    for (const name of Object.keys(functions)) {
      expect(filtered).toContain(
        JSON.stringify({ Ref: `${capitalised(name)}LogGroup` }),
      );
    }
  });

  it("has the three alarms", () => {
    const alarms = Object.values(serverless().resources.Resources)
      .filter((resource) => resource.Type === "AWS::CloudWatch::Alarm")
      .map((resource) => resource.Properties?.AlarmName);
    expect(alarms.sort()).toEqual([
      "spotimy-error-lines",
      "spotimy-function-failures",
      "spotimy-spend",
    ]);
  });
});
