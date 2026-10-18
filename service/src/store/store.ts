// The one module that reads or writes the table (table-design.md).
import {
  ConditionalCheckFailedException,
  DynamoDBClient,
  TransactionCanceledException,
} from "@aws-sdk/client-dynamodb";
import {
  BatchWriteCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import {
  defaultSettings,
  jobs,
  lastRunSchema,
  settingsSchema,
  type LastRun,
  type Settings,
} from "../../../shared/page-api";
import { awsClientConfig } from "../aws";
import { runIdSchema, userIdSchema, type UserId } from "../ids";
import type { StoredTokens } from "../spotify/auth";
import { memorySchema, type Memory } from "../sync/plan";
import { verdictSchema, type Verdict } from "../sync/verdict";
import { keys, type Key } from "./keys";

export const profileSchema = z.object({
  id: userIdSchema,
  name: z.string(),
  settings: settingsSchema,
  joinedAt: z.string(),
});

export type Profile = z.infer<typeof profileSchema>;

const memberSchema = z.object({ id: userIdSchema, name: z.string() });

export type Member = z.infer<typeof memberSchema>;

const tokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresAt: z.number(),
});

export const runSchema = z.object({
  runId: runIdSchema,
  job: z.enum(jobs),
  // Who asked, for an apply. Nobody, for the schedule.
  requestedBy: userIdSchema.nullable(),
  state: z.enum(["running", "paused"]),
  startedAt: z.string(),
  retryAt: z.string().nullable(),
  // Seconds since the epoch. Past this, another run may take over.
  expiresAt: z.number(),
});

export type RunState = z.infer<typeof runSchema>;

export interface Store {
  getProfile: (id: UserId) => Promise<Profile | undefined>;
  putSettings: (id: UserId, settings: Settings) => Promise<void>;
  // Adds the person to the group, or refreshes their name and tokens.
  join: (member: Member, tokens: StoredTokens, now: Date) => Promise<void>;
  listMembers: () => Promise<Member[]>;
  getTokens: (id: UserId) => Promise<StoredTokens | undefined>;
  // Writes only while the person is a member, so a run or a token refresh
  // that ends after they left keeps nothing of theirs. False if they left.
  putTokens: (id: UserId, tokens: StoredTokens) => Promise<boolean>;
  getVerdicts: () => Promise<Map<string, Verdict>>;
  putVerdicts: (verdicts: Verdict[]) => Promise<void>;
  getLastRun: (id: UserId) => Promise<LastRun | undefined>;
  getMemory: (id: UserId) => Promise<Memory | undefined>;
  // Writes only while the person is a member, as putTokens does.
  putMemberState: (
    id: UserId,
    state: { memory: Memory; lastRun?: LastRun },
  ) => Promise<boolean>;
  getRun: () => Promise<RunState | undefined>;
  // Takes the group's one run, if it is free, lapsed or already this run's.
  takeRun: (run: RunState, now: Date) => Promise<boolean>;
  pauseRun: (runId: string, retryAt: Date) => Promise<void>;
  endRun: (runId: string) => Promise<void>;
  // Deletes everything the person's key holds, their membership, and what
  // was found about the playlists they own.
  leave: (id: UserId) => Promise<void>;
}

const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

export function createStore(config: {
  tableName: string;
  endpoint?: string | undefined;
}): Store {
  const TableName = config.tableName;
  const db = DynamoDBDocumentClient.from(
    new DynamoDBClient(awsClientConfig(config.endpoint)),
    { marshallOptions: { removeUndefinedValues: true } },
  );

  const get = async <T>(
    key: Key,
    schema: z.ZodType<T>,
  ): Promise<T | undefined> => {
    const { Item } = await db.send(
      new GetCommand({ TableName, Key: key, ConsistentRead: true }),
    );
    if (Item === undefined) return undefined;
    return schema.parse(Item);
  };

  const put = async (key: Key, value: object) => {
    await db.send(new PutCommand({ TableName, Item: { ...value, ...key } }));
  };

  const query = async (
    pk: string,
    prefix?: string,
  ): Promise<Record<string, unknown>[]> => {
    const items: Record<string, unknown>[] = [];
    let start: Record<string, unknown> | undefined;
    do {
      const answer = await db.send(
        new QueryCommand({
          TableName,
          KeyConditionExpression:
            prefix === undefined
              ? "pk = :pk"
              : "pk = :pk AND begins_with(sk, :prefix)",
          ExpressionAttributeValues: {
            ":pk": pk,
            ...(prefix === undefined ? {} : { ":prefix": prefix }),
          },
          ConsistentRead: true,
          ...(start === undefined ? {} : { ExclusiveStartKey: start }),
        }),
      );
      items.push(...(answer.Items ?? []));
      start = answer.LastEvaluatedKey;
    } while (start !== undefined);
    return items;
  };

  type WriteRequest =
    | { PutRequest: { Item: Record<string, unknown> } }
    | { DeleteRequest: { Key: Key } };

  const batchWrite = async (requests: WriteRequest[]) => {
    for (let at = 0; at < requests.length; at += 25) {
      let pending = requests.slice(at, at + 25);
      for (let tries = 0; pending.length > 0; tries += 1) {
        if (tries > 8) throw new Error("The table would not take a batch.");
        const answer = await db.send(
          new BatchWriteCommand({ RequestItems: { [TableName]: pending } }),
        );
        const left = answer.UnprocessedItems?.[TableName] ?? [];
        pending = left.flatMap((request): WriteRequest[] => {
          if (request.PutRequest?.Item !== undefined) {
            return [{ PutRequest: { Item: request.PutRequest.Item } }];
          }
          const key = request.DeleteRequest?.Key;
          if (
            key !== undefined &&
            typeof key.pk === "string" &&
            typeof key.sk === "string"
          ) {
            return [{ DeleteRequest: { Key: { pk: key.pk, sk: key.sk } } }];
          }
          return [];
        });
        if (pending.length > 0) {
          await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** tries));
        }
      }
    }
  };

  const whileMember = async (
    id: UserId,
    writes: { key: Key; value: object }[],
  ): Promise<boolean> => {
    try {
      await db.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              ConditionCheck: {
                TableName,
                Key: keys.profile(id),
                ConditionExpression: "attribute_exists(pk)",
              },
            },
            ...writes.map(({ key, value }) => ({
              Put: { TableName, Item: { ...value, ...key } },
            })),
          ],
        }),
      );
      return true;
    } catch (error) {
      // Only a failed check means they left. A conflict is thrown on.
      if (
        error instanceof TransactionCanceledException &&
        error.CancellationReasons?.[0]?.Code === "ConditionalCheckFailed"
      ) {
        return false;
      }
      throw error;
    }
  };

  return {
    getProfile: (id) => get(keys.profile(id), profileSchema),

    putSettings: async (id, settings) => {
      const profile = await get(keys.profile(id), profileSchema);
      if (profile === undefined) return;
      await put(keys.profile(id), { ...profile, settings });
    },

    join: async (member, tokens, now) => {
      const profile = await get(keys.profile(member.id), profileSchema);
      await db.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName,
                Item: {
                  ...keys.profile(member.id),
                  id: member.id,
                  name: member.name,
                  settings: profile?.settings ?? defaultSettings,
                  joinedAt: profile?.joinedAt ?? now.toISOString(),
                },
              },
            },
            {
              Put: {
                TableName,
                Item: {
                  ...keys.member(member.id),
                  id: member.id,
                  name: member.name,
                },
              },
            },
            {
              Put: {
                TableName,
                Item: { ...keys.token(member.id), ...tokens },
              },
            },
          ],
        }),
      );
    },

    listMembers: async () =>
      (await query(keys.members().pk, keys.members().prefix)).map((item) =>
        memberSchema.parse(item),
      ),

    getTokens: (id) => get(keys.token(id), tokensSchema),

    putTokens: (id, tokens) =>
      whileMember(id, [{ key: keys.token(id), value: tokens }]),

    getVerdicts: async () => {
      const items = await query(keys.playlists().pk, keys.playlists().prefix);
      const verdicts = new Map<string, Verdict>();
      for (const item of items) {
        // An item from an older build that no longer fits is read again.
        const parsed = verdictSchema.safeParse(item);
        if (parsed.success) verdicts.set(parsed.data.playlistId, parsed.data);
      }
      return verdicts;
    },

    putVerdicts: (verdicts) =>
      batchWrite(
        verdicts.map((verdict) => ({
          PutRequest: {
            Item: { ...verdict, ...keys.playlist(verdict.playlistId) },
          },
        })),
      ),

    getLastRun: (id) => get(keys.plan(id), lastRunSchema),

    getMemory: (id) => get(keys.memory(id), memorySchema),

    putMemberState: (id, state) =>
      whileMember(id, [
        { key: keys.memory(id), value: state.memory },
        ...(state.lastRun === undefined
          ? []
          : [{ key: keys.plan(id), value: state.lastRun }]),
      ]),

    getRun: async () => {
      const run = await get(keys.run(), runSchema);
      return run;
    },

    takeRun: async (run, now) => {
      try {
        await db.send(
          new PutCommand({
            TableName,
            Item: { ...run, ...keys.run() },
            ConditionExpression:
              "attribute_not_exists(pk) OR expiresAt < :now OR runId = :runId",
            ExpressionAttributeValues: {
              ":now": seconds(now),
              ":runId": run.runId,
            },
          }),
        );
        return true;
      } catch (error) {
        if (error instanceof ConditionalCheckFailedException) return false;
        throw error;
      }
    },

    pauseRun: async (runId, retryAt) => {
      const run = await get(keys.run(), runSchema);
      if (run?.runId !== runId) return;
      await put(keys.run(), {
        ...run,
        state: "paused",
        retryAt: retryAt.toISOString(),
        expiresAt: seconds(retryAt),
      });
    },

    endRun: async (runId) => {
      try {
        await db.send(
          new DeleteCommand({
            TableName,
            Key: keys.run(),
            ConditionExpression: "runId = :runId",
            ExpressionAttributeValues: { ":runId": runId },
          }),
        );
      } catch (error) {
        if (!(error instanceof ConditionalCheckFailedException)) throw error;
      }
    },

    leave: async (id) => {
      // The profile goes first, so writes that check for it stop at once.
      await db.send(new DeleteCommand({ TableName, Key: keys.profile(id) }));
      const items = await query(keys.userItems(id).pk);
      const own = items.flatMap((item) =>
        typeof item.pk === "string" && typeof item.sk === "string"
          ? [{ DeleteRequest: { Key: { pk: item.pk, sk: item.sk } } }]
          : [],
      );
      const playlists = (
        await query(keys.playlists().pk, keys.playlists().prefix)
      ).flatMap((item) => {
        const parsed = verdictSchema.safeParse(item);
        return parsed.success && parsed.data.ownerId === id
          ? [{ DeleteRequest: { Key: keys.playlist(parsed.data.playlistId) } }]
          : [];
      });
      await batchWrite([
        ...own,
        ...playlists,
        { DeleteRequest: { Key: keys.member(id) } },
      ]);
    },
  };
}
