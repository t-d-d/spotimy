import { z } from "zod";

export const events = [
  "request-failed",
  "origin-refused",
  "input-invalid",
  "session-missing",
  "session-rejected",
  "sign-in-started",
  "signed-in",
  "sign-in-refused",
  "signed-out",
  "left",
  "settings-saved",
  "run-requested",
  "run-busy",
  "run-started",
  "run-continued",
  "run-paused",
  "run-finished",
  "run-failed",
  "library-read",
  "playlists-identified",
  "plan-made",
  // An apply named a plan that has since been replaced, so it did nothing.
  "apply-refused",
  "changes-applied",
  "apply-failed",
  "token-refresh-failed",
  "spotify-retried",
  "spotify-rate-limited",
  "followed-tracks-unreadable",
  // Spotify refused a call about one playlist. It is skipped this run.
  "playlist-unreadable",
  // Spotify refused a search by name. After a 403, or three in a row, the
  // run stops searching.
  "name-search-refused",
  // How far a run has got, or how it ended, could not be saved for the page.
  "progress-unwritten",
  "outcome-unwritten",
] as const;

export type Event = (typeof events)[number];

const id = z.string().regex(/^[\w.-]{1,128}$/u);
const count = z.number().int().nonnegative();

const fieldsSchema = z.strictObject({
  userId: id.optional(),
  runId: id.optional(),
  job: z.enum(["schedule", "check", "apply"]).optional(),
  // A dependency's error class or code, never its message.
  errorClass: z
    .string()
    .regex(/^[A-Za-z0-9_.:-]{1,64}$/u)
    .optional(),
  status: z.number().int().optional(),
  retryAfter: count.optional(),
  playlists: count.optional(),
  albums: count.optional(),
  read: count.optional(),
  save: count.optional(),
  follow: count.optional(),
  create: count.optional(),
  failed: count.optional(),
});

export type Fields = z.input<typeof fieldsSchema>;

// error: someone is alerted now. warn: handled, but suspect. info: as
// designed, expected refusals included.
export interface Logger {
  info: (event: Event, fields?: Fields) => void;
  warn: (event: Event, fields?: Fields) => void;
  error: (event: Event, fields?: Fields) => void;
}

type Level = keyof Logger;

export function createLogger(requestId: string): Logger {
  const write = (level: Level, event: Event, fields: Fields = {}) => {
    // One bad field drops them all, so nothing it held can reach the line.
    const parsed = fieldsSchema.safeParse(fields);
    const line = {
      event,
      requestId,
      ...(parsed.success ? parsed.data : { fieldsRejected: true }),
    };
    // Lambda's JSON log format stores the object as the message and takes
    // the level from the console method.
    console[level](line); // eslint-disable-line no-console -- the shared logger is the one place that writes a line
  };
  return {
    info: (event, fields) => {
      write("info", event, fields);
    },
    warn: (event, fields) => {
      write("warn", event, fields);
    },
    error: (event, fields) => {
      write("error", event, fields);
    },
  };
}

export function errorClass(error: unknown): string {
  if (!(error instanceof Error)) return typeof error;
  const code = "code" in error ? error.code : undefined;
  const name = typeof code === "string" ? code : error.name;
  return /^[A-Za-z0-9_.:-]{1,64}$/u.test(name) ? name : "Error";
}

// An error's class, and the status a dependency answered with when it has
// one, as logging.md asks. Never its message.
export function errorFields(error: unknown): {
  errorClass: string;
  status?: number;
} {
  const status =
    error instanceof Error &&
    "status" in error &&
    typeof error.status === "number" &&
    Number.isInteger(error.status)
      ? error.status
      : undefined;
  return status === undefined
    ? { errorClass: errorClass(error) }
    : { errorClass: errorClass(error), status };
}

// Tests and tools that need a logger and no lines.
export const silentLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
