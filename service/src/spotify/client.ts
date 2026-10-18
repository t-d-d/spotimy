// Spotify's Web API, paced and retried as spotify-api.md says.
import type { z } from "zod";
import { discardBody, requiredBody } from "../http";
import type { Logger } from "../log";
import { pageSchema } from "./schemas";

export interface TokenSource {
  current: () => Promise<string>;
  // Called once after a 401, for a token Spotify will take.
  renew: () => Promise<string>;
}

export class SpotifyError extends Error {
  override name = "SpotifyError";
  readonly status: number;
  constructor(status: number, what: string) {
    super(`Spotify answered ${String(status)} to ${what}.`);
    this.status = status;
  }
}

// Spotify asked for a wait longer than a run should sit through.
export class RateLimited extends Error {
  override name = "RateLimited";
  readonly retryAfter: number;
  constructor(retryAfter: number) {
    super(`Spotify asked for a wait of ${String(retryAfter)} seconds.`);
    this.retryAfter = retryAfter;
  }
}

export interface SpotifyClient {
  get: <T>(path: string, schema: z.ZodType<T>) => Promise<T>;
  pages: <T>(path: string, item: z.ZodType<T>) => AsyncGenerator<T>;
  put: (path: string) => Promise<void>;
  post: <T>(path: string, body: unknown, schema: z.ZodType<T>) => Promise<T>;
}

export interface ClientOptions {
  apiBase: string;
  tokens: TokenSource;
  log: Logger;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  // The gap kept between two calls.
  gapMs?: number;
  // The longest Retry-After a call waits through before giving up.
  maxWaitSeconds?: number;
}

export const defaultGapMs = 120;
export const defaultMaxWaitSeconds = 20;
const maxTries = 6;

const realSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createSpotifyClient(options: ClientOptions): SpotifyClient {
  const {
    apiBase,
    tokens,
    log,
    fetch: send = fetch,
    sleep = realSleep,
    gapMs = defaultGapMs,
    maxWaitSeconds = defaultMaxWaitSeconds,
  } = options;
  let lastCall = 0;

  // A next link from Spotify is followed only if it stays on the API, so
  // the token is never sent anywhere else.
  const urlOf = (path: string): string => {
    if (path.startsWith("/")) return `${apiBase}${path}`;
    if (path.startsWith(`${apiBase}/`)) return path;
    throw new Error("A Spotify link pointed away from the API.");
  };

  const call = async (
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response> => {
    const url = urlOf(path);
    const what = `${method} ${new URL(url).pathname}`;
    let renewed = false;
    for (let attempt = 1; ; attempt += 1) {
      const wait = lastCall + gapMs - Date.now();
      if (wait > 0) await sleep(wait);
      lastCall = Date.now();
      const token = await tokens.current();
      let response: Response;
      try {
        response = await send(url, {
          method,
          headers: {
            authorization: `Bearer ${token}`,
            ...(body === undefined
              ? {}
              : { "content-type": "application/json" }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
      } catch (error) {
        if (attempt >= 3) throw error;
        log.warn("spotify-retried", { errorClass: "NetworkError" });
        await sleep(1000 * attempt);
        continue;
      }
      if (response.ok) return response;
      await discardBody(response);
      if (response.status === 429) {
        const retryAfter = Math.max(
          1,
          Math.ceil(Number(response.headers.get("retry-after") ?? "5") || 5),
        );
        if (retryAfter > maxWaitSeconds || attempt >= maxTries) {
          log.warn("spotify-rate-limited", { retryAfter });
          throw new RateLimited(retryAfter);
        }
        log.info("spotify-retried", { status: 429, retryAfter });
        await sleep((retryAfter + 1) * 1000);
        continue;
      }
      if (response.status === 401 && !renewed) {
        renewed = true;
        await tokens.renew();
        continue;
      }
      if (response.status >= 500 && attempt < 3) {
        log.warn("spotify-retried", { status: response.status });
        await sleep(1000 * attempt);
        continue;
      }
      throw new SpotifyError(response.status, what);
    }
  };

  return {
    get: async (path, schema) =>
      requiredBody(await call("GET", path), schema, `GET ${path}`),
    pages: async function* pages<T>(path: string, item: z.ZodType<T>) {
      const schema = pageSchema(item);
      let next: string | null = path;
      while (next !== null) {
        const page: { items: (T | null)[]; next: string | null } =
          await requiredBody(
            await call("GET", next),
            schema,
            "a page from Spotify",
          );
        for (const entry of page.items) {
          if (entry !== null) yield entry;
        }
        next = page.next;
      }
    },
    put: async (path) => {
      await discardBody(await call("PUT", path));
    },
    post: async (path, body, schema) =>
      requiredBody(await call("POST", path, body), schema, `POST ${path}`),
  };
}
