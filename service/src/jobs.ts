// Starts the worker without waiting for it (hosting.md).
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { jobs } from "../../shared/page-api";
import { awsClientConfig } from "./aws";
import { runIdSchema, userIdSchema } from "./ids";
import type { Job } from "./sync/run";

export const jobSchema = z.object({
  kind: z.enum(jobs),
  requestedBy: userIdSchema.nullable(),
  runId: runIdSchema,
  hop: z.number().int().nonnegative(),
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
