// Global setup for the integration tier: DynamoDB Local in Docker.
import { execFile, spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";
import {
  CreateTableCommand,
  DynamoDBClient,
  ListTablesCommand,
} from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { TestProject } from "vitest/node";
import { z } from "zod";
import { readYaml } from "./repo.ts";

declare module "vitest" {
  export interface ProvidedContext {
    databaseEndpoint: string;
    tableName: string;
  }
}

const image = "amazon/dynamodb-local:3.3.1";
const tableName = "spotimy";

const run = promisify(execFile);

// DynamoDB Local accepts any credentials.
export function localClient(endpoint: string): DynamoDBClient {
  return new DynamoDBClient({
    endpoint,
    region: "us-east-1",
    credentials: { accessKeyId: "local", secretAccessKey: "local" },
  });
}

const dockerAnswers = () =>
  run("docker", ["info"], { timeout: 10_000 }).then(
    () => true,
    () => false,
  );

// A cloud session starts with no Docker daemon running.
async function dockerRunning(): Promise<void> {
  if (await dockerAnswers()) return;
  await new Promise<void>((resolve, reject) => {
    const daemon = spawn("dockerd", [], { detached: true, stdio: "ignore" });
    daemon.once("error", () => {
      reject(
        new Error(
          "The integration tier needs Docker for its local DynamoDB. Start Docker and run the gate again.",
        ),
      );
    });
    daemon.once("spawn", () => {
      daemon.unref();
      resolve();
    });
  });
  for (let tries = 0; tries < 60; tries += 1) {
    if (await dockerAnswers()) return;
    await sleep(500);
  }
  throw new Error("The Docker daemon did not start within 30 seconds.");
}

const tableSchema = z.object({
  resources: z.object({
    Resources: z.object({
      Table: z.object({
        Properties: z.object({
          BillingMode: z.literal("PAY_PER_REQUEST"),
          AttributeDefinitions: z.array(
            z.object({
              AttributeName: z.string(),
              AttributeType: z.enum(["S", "N", "B"]),
            }),
          ),
          KeySchema: z.array(
            z.object({
              AttributeName: z.string(),
              KeyType: z.enum(["HASH", "RANGE"]),
            }),
          ),
        }),
      }),
    }),
  }),
});

async function ready(client: DynamoDBClient): Promise<void> {
  let failure: unknown;
  for (let tries = 0; tries < 60; tries += 1) {
    try {
      await client.send(new ListTablesCommand({}));
      return;
    } catch (error) {
      failure = error;
      await sleep(250);
    }
  }
  throw new Error("The local DynamoDB did not answer.", { cause: failure });
}

// cat waits on stdin, which this run holds open through the docker client
// it starts. However the run ends, the stream closes, the shell exits and
// the container is removed. This ties the container to the run and not to a
// process id or hostname, which another run on the daemon may share.
const untilRunEnds =
  "java -jar DynamoDBLocal.jar -inMemory -sharedDb & cat > /dev/null";

async function startDatabase(): Promise<string> {
  // Made as a step of its own, so the image is pulled before anything waits
  // for the container to start.
  const { stdout } = await run("docker", [
    "create",
    "--interactive",
    "--rm",
    "--publish",
    "127.0.0.1::8000",
    "--entrypoint",
    "sh",
    image,
    "-c",
    untilRunEnds,
  ]);
  const container = stdout.trim();
  // The client attaches before it starts the container, so the container
  // never runs without its stdin held. It writes only if the start fails.
  spawn("docker", ["start", "--attach", "--interactive", container], {
    stdio: ["pipe", "ignore", "inherit"],
  });
  return container;
}

async function publishedEndpoint(container: string): Promise<string> {
  for (let tries = 0; tries < 60; tries += 1) {
    const port = await run("docker", ["port", container, "8000/tcp"]).then(
      ({ stdout }) => /:(\d+)\s*$/mu.exec(stdout.split("\n")[0] ?? "")?.[1],
      () => undefined,
    );
    if (port !== undefined) return `http://127.0.0.1:${port}`;
    await sleep(250);
  }
  throw new Error("The local DynamoDB has no port.");
}

export default async function setup(
  project: TestProject,
): Promise<() => Promise<void>> {
  await dockerRunning();
  const container = await startDatabase();
  const stop = async () => {
    await run("docker", ["rm", "--force", container]);
  };
  try {
    const endpoint = await publishedEndpoint(container);
    const client = localClient(endpoint);
    await ready(client);
    const { Properties: table } = readYaml("serverless.yml", tableSchema)
      .resources.Resources.Table;
    await client.send(
      new CreateTableCommand({ TableName: tableName, ...table }),
    );
    client.destroy();
    project.provide("databaseEndpoint", endpoint);
    project.provide("tableName", tableName);
  } catch (error) {
    await stop();
    throw error;
  }
  return stop;
}

// Every item under one partition key, for a test to look at.
export async function storedItems(
  endpoint: string,
  table: string,
  pk: string,
): Promise<Record<string, unknown>[]> {
  const db = DynamoDBDocumentClient.from(localClient(endpoint));
  try {
    const { Items } = await db.send(
      new QueryCommand({
        TableName: table,
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: { ":pk": pk },
        ConsistentRead: true,
      }),
    );
    return Items ?? [];
  } finally {
    db.destroy();
  }
}

// A fresh, empty table, so each test starts from nothing.
export async function createTable(
  endpoint: string,
  name: string,
): Promise<void> {
  const client = localClient(endpoint);
  try {
    const { Properties: table } = readYaml("serverless.yml", tableSchema)
      .resources.Resources.Table;
    await client.send(new CreateTableCommand({ TableName: name, ...table }));
  } finally {
    client.destroy();
  }
}
