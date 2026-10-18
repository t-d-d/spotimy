// The worker: a run for the whole group, on the daily schedule or when a
// person asks (hosting.md).
import { z } from "zod";
import { jobSchema, newRunId } from "./jobs";
import { createLogger, errorClass } from "./log";
import { ready } from "./services";
import { runGroup, type Job } from "./sync/run";

export type { Job };

const scheduledSchema = z.object({
  source: z.literal("aws.events"),
  "detail-type": z.literal("Scheduled Event"),
});

export interface WorkerContext {
  awsRequestId: string;
  getRemainingTimeInMillis: () => number;
}

export function jobOf(event: unknown): Job | undefined {
  if (scheduledSchema.safeParse(event).success) {
    return {
      kind: "schedule",
      requestedBy: null,
      runId: newRunId(),
      hop: 0,
      approved: null,
      carried: null,
    };
  }
  const parsed = jobSchema.safeParse(event);
  return parsed.success ? parsed.data : undefined;
}

export async function handler(
  event: unknown,
  context: WorkerContext,
): Promise<void> {
  const log = createLogger(context.awsRequestId);
  const job = jobOf(event);
  if (job === undefined) {
    log.error("run-failed", { errorClass: "UnreadableEvent" });
    return;
  }
  const { store, now, clientFor, startJob } = ready();
  try {
    const result = await runGroup(job, {
      store,
      log,
      now,
      clientFor: (member) => clientFor(member, log),
      remainingMs: () => context.getRemainingTimeInMillis(),
    });
    if (result.state === "continue") {
      await startJob({ ...job, hop: job.hop + 1, carried: result.carried });
    }
  } catch (error) {
    // runGroup has logged it and freed the lock. Async invokes are not
    // retried (serverless.yml), so nothing runs twice.
    log.error("request-failed", {
      errorClass: errorClass(error),
      runId: job.runId,
    });
  }
}
