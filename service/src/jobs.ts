// Starts the worker without waiting for it (hosting.md).
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { jobs } from "../../shared/page-api";
import { awsClientConfig } from "./aws";
import { runIdSchema, userIdSchema } from "./ids";
import type { Job } from "./sync/run";

const count = z.number().int().nonnegative();

export const jobSchema = z.object({
  kind: z.enum(jobs),
  requestedBy: userIdSchema.nullable(),
  runId: runIdSchema,
  hop: count,
  // For an apply, the run that made the plan the person saw and approved.
  approved: z.string().nullable(),
  // What earlier invocations of this run applied, carried to the next.
  carried: z
    .object({
      saved: count,
      followed: count,
      created: z.array(z.object({ name: z.string(), year: z.string() })),
      finished: count,
      failed: count,
    })
    .nullable(),
});

export const newRunId = (): string => randomBytes(12).toString("base64url");

export type StartJob = (job: Job) => Promise<void>;

export function createJobStarter(config: {
  functionName: string;
  endpoint?: string | undefined;
}): StartJob {
  const client = new LambdaClient(awsClientConfig(config.endpoint));
  return async (job) => {
    await client.send(
      new InvokeCommand({
        FunctionName: config.functionName,
        InvocationType: "Event",
        Payload: new TextEncoder().encode(JSON.stringify(job)),
      }),
    );
  };
}
