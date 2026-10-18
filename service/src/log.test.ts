import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger, errorClass } from "./log";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the logger", () => {
  it("writes the event, the request and the fields it allows", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    createLogger("req1").info("plan-made", { userId: "thomas", save: 3 });
    expect(info).toHaveBeenCalledWith({
      event: "plan-made",
      requestId: "req1",
      userId: "thomas",
      save: 3,
    });
  });

  it("drops every field when one could carry content", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    createLogger("req1").warn("apply-failed", {
      userId: "Death Cab for Cutie – I Built You A Tower",
    });
    expect(warn).toHaveBeenCalledWith({
      event: "apply-failed",
      requestId: "req1",
      fieldsRejected: true,
    });
  });

  it("names an error by its class or code, never its message", () => {
    expect(errorClass(new TypeError("secret"))).toBe("TypeError");
    expect(
      errorClass(Object.assign(new Error("x"), { code: "ECONNRESET" })),
    ).toBe("ECONNRESET");
    expect(errorClass("text")).toBe("string");
  });
});
