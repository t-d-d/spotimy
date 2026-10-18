// The function behind API Gateway: the page's API and Spotify sign-in.
import { serve } from "./api";
import { incoming, result, type Result } from "./http";
import { createLogger, errorClass } from "./log";
import { isRoute } from "./routes";
import { ready } from "./services";

const unavailable = () =>
  Response.json(
    { error: "unavailable" },
    { status: 503, headers: { "cache-control": "no-store" } },
  );

export async function handler(event: unknown): Promise<Result> {
  const services = ready();
  const call = incoming(event, services.env.publicUrl);
  if (call === undefined) {
    // API Gateway always sends a well-formed event, so this is spotimy's fault.
    createLogger("unknown").error("request-failed", {
      errorClass: "UnreadableEvent",
    });
    return result(unavailable());
  }
  const log = createLogger(call.requestId);
  if (!isRoute(call.route)) return result(new Response(null, { status: 404 }));
  try {
    return await result(
      await serve(
        {
          route: call.route,
          request: call.request,
          cookies: call.cookies,
          log,
        },
        services,
      ),
    );
  } catch (error) {
    log.error("request-failed", { errorClass: errorClass(error) });
    return result(unavailable());
  }
}
