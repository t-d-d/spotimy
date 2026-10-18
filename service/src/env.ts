import { z } from "zod";

const loopback = new Set(["127.0.0.1", "localhost", "[::1]"]);

const isLoopback = (url: URL) => loopback.has(url.hostname);

// Plain http is allowed only on loopback, where the tests run stand-ins.
const origin = (name: string) =>
  z
    .url({ error: `${name} must be an address.` })
    .transform((value) => new URL(value))
    .refine(
      (url) =>
        url.protocol === "https:" ||
        (url.protocol === "http:" && isLoopback(url)),
      { error: `${name} must use https.` },
    )
    .refine(
      (url) =>
        (url.pathname === "/" || url.pathname === "") &&
        url.search === "" &&
        url.hash === "",
      { error: `${name} must be an origin, with no path, query or fragment.` },
    )
    .transform((url) => url.origin);

// Only the integration tier's stand-ins set these (test-tiers.md).
// Production leaves them unset.
const loopbackEndpoint = (name: string) =>
  z
    .url({ error: `${name} must be an address.` })
    .refine((value) => URL.canParse(value) && isLoopback(new URL(value)), {
      error: `${name} may only point to this machine.`,
    });

const named = (name: string, what: string) =>
  z
    .string({ error: `${name} must name ${what}.` })
    .min(1, { error: `${name} must name ${what}.` });

const envSchema = z.object({
  PUBLIC_URL: origin("PUBLIC_URL"),
  TABLE_NAME: named("TABLE_NAME", "the table"),
  SPOTIFY_CLIENT_ID: z
    .string({ error: "SPOTIFY_CLIENT_ID must be the Spotify app's id." })
    .regex(/^[A-Za-z0-9]{8,64}$/u, {
      error: "SPOTIFY_CLIENT_ID must be the Spotify app's id.",
    }),
  SESSION_KEY_PARAMETER: named(
    "SESSION_KEY_PARAMETER",
    "the parameter that holds the session key",
  ),
  WORKER_FUNCTION: named("WORKER_FUNCTION", "the worker function"),
  DYNAMODB_ENDPOINT: loopbackEndpoint("DYNAMODB_ENDPOINT").optional(),
  SSM_ENDPOINT: loopbackEndpoint("SSM_ENDPOINT").optional(),
  LAMBDA_ENDPOINT: loopbackEndpoint("LAMBDA_ENDPOINT").optional(),
  SPOTIFY_API_BASE: loopbackEndpoint("SPOTIFY_API_BASE").optional(),
  SPOTIFY_ACCOUNTS_BASE: loopbackEndpoint("SPOTIFY_ACCOUNTS_BASE").optional(),
});

export const spotifyApiBase = "https://api.spotify.com/v1";
export const spotifyAccountsBase = "https://accounts.spotify.com";

export interface Env {
  publicUrl: string;
  tableName: string;
  spotifyClientId: string;
  sessionKeyParameter: string;
  workerFunction: string;
  spotifyApiBase: string;
  spotifyAccountsBase: string;
  databaseEndpoint?: string;
  ssmEndpoint?: string;
  lambdaEndpoint?: string;
}

export function readEnv(
  // eslint-disable-next-line no-restricted-properties -- this module is where the environment is read
  source: Record<string, string | undefined> = process.env,
): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(
      `The environment is not set up: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  const env = parsed.data;
  return {
    publicUrl: env.PUBLIC_URL,
    tableName: env.TABLE_NAME,
    spotifyClientId: env.SPOTIFY_CLIENT_ID,
    sessionKeyParameter: env.SESSION_KEY_PARAMETER,
    workerFunction: env.WORKER_FUNCTION,
    spotifyApiBase: env.SPOTIFY_API_BASE ?? spotifyApiBase,
    spotifyAccountsBase: env.SPOTIFY_ACCOUNTS_BASE ?? spotifyAccountsBase,
    ...(env.DYNAMODB_ENDPOINT === undefined
      ? {}
      : { databaseEndpoint: env.DYNAMODB_ENDPOINT }),
    ...(env.SSM_ENDPOINT === undefined
      ? {}
      : { ssmEndpoint: env.SSM_ENDPOINT }),
    ...(env.LAMBDA_ENDPOINT === undefined
      ? {}
      : { lambdaEndpoint: env.LAMBDA_ENDPOINT }),
  };
}
