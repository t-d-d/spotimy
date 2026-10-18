import { useCallback, useEffect, useState } from "react";
import type { Status } from "../../shared/page-api";
import { getStatus, SignedOut } from "./api";

export type Loaded =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "failed" }
  | { kind: "ready"; status: Status };

// While a run goes, the page asks again every few seconds, and not at all
// while it is hidden.
export const pollMs = 3000;

export function useStatus() {
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });

  const settle = useCallback(
    (answer: Promise<Status>) =>
      answer.then(
        (status) => {
          setLoaded({ kind: "ready", status });
        },
        (error: unknown) => {
          setLoaded({
            kind: error instanceof SignedOut ? "signed-out" : "failed",
          });
        },
      ),
    [],
  );

  const load = useCallback(() => settle(getStatus()), [settle]);

  useEffect(() => {
    void settle(getStatus());
  }, [settle]);

  const running =
    loaded.kind === "ready" && loaded.status.run.state === "running";
  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, pollMs);
    return () => {
      clearInterval(timer);
    };
  }, [running, load]);

  const show = useCallback((status: Status) => {
    setLoaded({ kind: "ready", status });
  }, []);

  return { loaded, load, show };
}
