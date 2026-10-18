import { describe, expect, it } from "vitest";
import { incoming, parseCookies, result } from "./http";

const event = (overrides: Record<string, unknown> = {}) => ({
  routeKey: "GET /api/status",
  rawPath: "/api/status",
  rawQueryString: "a=1",
  cookies: ["__Host-session=abc", "other=1; more=2"],
  headers: { origin: "https://example.cloudfront.net" },
  isBase64Encoded: false,
  requestContext: { requestId: "Abc123=", http: { method: "GET" } },
  ...overrides,
});

describe("http", () => {
  it("reads API Gateway's event against the public address", () => {
    const call = incoming(event(), "https://example.cloudfront.net");
    expect(call?.route).toBe("GET /api/status");
    expect(call?.request.url).toBe(
      "https://example.cloudfront.net/api/status?a=1",
    );
    expect(call?.cookies.get("__Host-session")).toBe("abc");
    expect(call?.cookies.get("more")).toBe("2");
  });

  it("refuses an event that is not API Gateway's", () => {
    expect(
      incoming({ hello: 1 }, "https://example.cloudfront.net"),
    ).toBeUndefined();
  });

  it("keeps the first of a repeated cookie", () => {
    expect(parseCookies(["a=1", "a=2; b=3"]).get("a")).toBe("1");
  });

  it("hands cookies back in API Gateway's own list", async () => {
    const headers = new Headers({ location: "/" });
    headers.append("set-cookie", "a=1");
    headers.append("set-cookie", "b=2");
    const answer = await result(new Response(null, { status: 302, headers }));
    expect(answer.cookies).toEqual(["a=1", "b=2"]);
    expect(answer.headers["set-cookie"]).toBeUndefined();
    expect(answer.headers.location).toBe("/");
  });
});
