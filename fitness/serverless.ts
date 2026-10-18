// serverless.yml, read as data for the fitness functions.
import { z } from "zod";
import { readYaml } from "../test/repo.ts";

const statementSchema = z.object({
  Effect: z.string(),
  Action: z.array(z.string()),
  Resource: z.unknown(),
});

const functionSchema = z.object({
  handler: z.string(),
  timeout: z.number().optional(),
  maximumRetryAttempts: z.number().optional(),
  events: z.array(z.record(z.string(), z.unknown())),
});

export const serverlessSchema = z.object({
  frameworkVersion: z.string(),
  provider: z.object({
    environment: z.record(z.string(), z.unknown()),
    iam: z.object({ role: z.object({ statements: z.array(statementSchema) }) }),
  }),
  functions: z.record(z.string(), functionSchema),
  resources: z.object({
    Resources: z.record(
      z.string(),
      z.object({
        Type: z.string(),
        Properties: z.record(z.string(), z.unknown()).optional(),
      }),
    ),
  }),
});

export const serverless = () => readYaml("serverless.yml", serverlessSchema);
