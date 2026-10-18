// Everything a function needs, made on first use so a test can set the
// environment first.
import { readEnv, type Env } from "./env";
import { createJobStarter, type StartJob } from "./jobs";
import { errorClass, type Logger } from "./log";
import { createKeyReader } from "./secrets";
import { createSessions, type Sessions } from "./session";
import { TokenRefused, tokenSource } from "./spotify/auth";
import { createSpotifyClient, type SpotifyClient } from "./spotify/client";
import { createStore, type Member, type Store } from "./store/store";

export interface Services {
  env: Env;
  store: Store;
  sessions: Sessions;
  startJob: StartJob;
  now: () => Date;
  clientFor: (
    member: Member,
    log: Logger,
    // Told of every call the client sends.
    onCall?: () => void,
  ) => Promise<SpotifyClient | undefined>;
}

let services: Services | undefined;

export function ready(): Services {
  if (services !== undefined) return services;
  const env = readEnv();
  const now = () => new Date();
  const store = createStore({
    tableName: env.tableName,
    endpoint: env.databaseEndpoint,
  });
  const made: Services = {
    env,
    store,
    now,
    sessions: createSessions({
      key: createKeyReader({
        parameter: env.sessionKeyParameter,
        endpoint: env.ssmEndpoint,
      }),
      now,
    }),
    startJob: createJobStarter({
      functionName: env.workerFunction,
      endpoint: env.lambdaEndpoint,
    }),
    clientFor: async (member, log, onCall) => {
      const initial = await store.getTokens(member.id);
      if (initial === undefined) return undefined;
      const tokens = tokenSource({
        accountsBase: env.spotifyAccountsBase,
        clientId: env.spotifyClientId,
        initial,
        save: async (next) => {
          await store.putTokens(member.id, next);
        },
        now,
      });
      try {
        await tokens.current();
      } catch (error) {
        // The person revoked spotimy, or Spotify dropped them from the
        // app's list. Their library is left alone until they sign in again.
        if (!(error instanceof TokenRefused)) throw error;
        log.warn("token-refresh-failed", {
          userId: member.id,
          status: error.status,
          errorClass: errorClass(error),
        });
        return undefined;
      }
      return createSpotifyClient({
        apiBase: env.spotifyApiBase,
        tokens,
        log,
        ...(onCall === undefined ? {} : { onCall }),
      });
    },
  };
  services = made;
  return made;
}

// For tests that change the environment between cases.
export function forgetServices(): void {
  services = undefined;
}
