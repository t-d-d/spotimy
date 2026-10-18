// The one module that reads a body: API Gateway's events, requests from the
// page, and answers from Spotify (types-and-lint.md).
import { z } from "zod";

// API Gateway's HTTP API sends version 2.0 events. It moves cookies out of
// the headers into their own list.
const eventSchema = z.object({
  routeKey: z.string(),
  rawPath: z.string(),
  rawQueryString: z.string(),
  cookies: z.array(z.string()).default([]),
  headers: z.record(z.string(), z.string()).default({}),
  body: z.string().optional(),
  isBase64Encoded: z.boolean(),
  requestContext: z.object({
    requestId: z.string().regex(/^[\w+/=-]{1,128}$/u),
    http: z.object({ method: z.string() }),
  }),
});

export interface Incoming {
  // As "METHOD /path".
  route: string;
  requestId: string;
  cookies: Map<string, string>;
  request: Request;
}

// The page and the API share one origin through CloudFront, so the request
// is rebuilt against it, whatever host API Gateway saw.
export function incoming(event: unknown, origin: string): Incoming | undefined {
  const parsed = eventSchema.safeParse(event);
  if (!parsed.success) return undefined;
  const { data } = parsed;
  // eslint-disable-next-line no-restricted-syntax -- this module is where a body is read
  const { body: raw } = data;
  const query = data.rawQueryString === "" ? "" : `?${data.rawQueryString}`;
  const method = data.requestContext.http.method;
  const hasBody = method !== "GET" && method !== "HEAD";
  const body =
    raw === undefined || !hasBody
      ? null
      : data.isBase64Encoded
        ? Buffer.from(raw, "base64")
        : raw;
  return {
    route: data.routeKey,
    requestId: data.requestContext.requestId,
    cookies: parseCookies(data.cookies),
    request: new Request(`${origin}${data.rawPath}${query}`, {
      method,
      headers: data.headers,
      body,
    }),
  };
}

// The first of a repeated name wins.
export function parseCookies(lines: string[]): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const line of lines.flatMap((entry) => entry.split(";"))) {
    const at = line.indexOf("=");
    if (at <= 0) continue;
    const name = line.slice(0, at).trim();
    if (!cookies.has(name)) cookies.set(name, line.slice(at + 1).trim());
  }
  return cookies;
}

// A body that is not JSON, or does not fit, is undefined.
export async function parsedBody<T>(
  source: Request | Response,
  schema: z.ZodType<T>,
): Promise<T | undefined> {
  let data: unknown;
  try {
    data = await source.json(); // eslint-disable-line no-restricted-syntax -- this module is where a body is read
  } catch {
    return undefined;
  }
  const parsed = schema.safeParse(data);
  return parsed.success ? parsed.data : undefined;
}

// Spotify's answers must fit: a misfit is Spotify's change or a bug, and
// the caller fails loudly.
export async function requiredBody<T>(
  response: Response,
  schema: z.ZodType<T>,
  what: string,
): Promise<T> {
  let data: unknown;
  try {
    data = await response.json(); // eslint-disable-line no-restricted-syntax -- this module is where a body is read
  } catch {
    throw new UnreadableAnswer(what);
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new UnreadableAnswer(what);
  return parsed.data;
}

export class UnreadableAnswer extends Error {
  override name = "UnreadableAnswer";
  constructor(what: string) {
    super(`The answer from ${what} did not fit its schema.`);
  }
}

// Drains a body nobody needs, so the connection can be reused.
export async function discardBody(response: Response): Promise<void> {
  await response.arrayBuffer().catch(() => undefined); // eslint-disable-line no-restricted-syntax -- this module is where a body is read
}

export interface Result {
  statusCode: number;
  headers: Record<string, string>;
  cookies: string[];
  body: string;
  isBase64Encoded: false;
}

export async function result(response: Response): Promise<Result> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    if (name !== "set-cookie") headers[name] = value;
  });
  return {
    statusCode: response.status,
    headers,
    cookies: response.headers.getSetCookie(),
    // eslint-disable-next-line no-restricted-syntax -- this module is where a body is read
    body: await response.text(),
    isBase64Encoded: false,
  };
}
