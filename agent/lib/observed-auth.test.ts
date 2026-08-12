import { diag } from "@opentelemetry/api";
import { type AuthFn, ForbiddenError } from "eve/channels/auth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TransportStream from "winston-transport";
import { configureDefaultLogger } from "./logger";
import { recordRateLimitRejection } from "./metrics";
import { observeRateLimit } from "./observed-auth";

vi.mock("./metrics", () => ({ recordRateLimitRejection: vi.fn() }));

class MemoryTransport extends TransportStream {
  public readonly records: Record<string, unknown>[] = [];

  override log(info: Record<string, unknown>, callback: () => void): void {
    this.records.push(info);
    callback();
  }
}

let logged: MemoryTransport;

const request = new Request("https://agent.example.com/eve/v1/session", {
  method: "POST",
});

describe("observeRateLimit", () => {
  beforeEach(() => {
    vi.mocked(recordRateLimitRejection).mockClear();
    logged = new MemoryTransport();
    configureDefaultLogger({ extraTransports: [logged] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes an under-the-limit result through untouched", async () => {
    const auth = vi.fn().mockResolvedValue(null) as unknown as AuthFn<Request>;

    await expect(observeRateLimit(auth)(request)).resolves.toBeNull();
    expect(recordRateLimitRejection).not.toHaveBeenCalled();
    expect(logged.records).toHaveLength(0);
  });

  it("counts and logs a rejection, then rethrows it", async () => {
    const forbidden = new ForbiddenError({ message: "rate limit exceeded" });
    const auth = vi
      .fn()
      .mockRejectedValue(forbidden) as unknown as AuthFn<Request>;

    await expect(observeRateLimit(auth)(request)).rejects.toBe(forbidden);
    expect(recordRateLimitRejection).toHaveBeenCalledTimes(1);
    expect(logged.records.at(-1)).toMatchObject({
      level: "warn",
      message: "rate limit rejected request",
      event: "rate_limit_rejected",
      method: "POST",
      path: "/eve/v1/session",
    });
  });

  it("still returns the 403 when its own telemetry throws", async () => {
    // Otherwise the caller sees a 500 and the gate looks broken.
    vi.spyOn(diag, "error").mockImplementation(() => undefined);
    vi.mocked(recordRateLimitRejection).mockImplementationOnce(() => {
      throw new Error("meter provider shut down");
    });
    const forbidden = new ForbiddenError({ message: "rate limit exceeded" });
    const auth = vi
      .fn()
      .mockRejectedValue(forbidden) as unknown as AuthFn<Request>;

    await expect(observeRateLimit(auth)(request)).rejects.toBe(forbidden);
  });

  it("leaves any other failure unreported as a rejection", async () => {
    const outage = new Error("redis unreachable");
    const auth = vi
      .fn()
      .mockRejectedValue(outage) as unknown as AuthFn<Request>;

    await expect(observeRateLimit(auth)(request)).rejects.toBe(outage);
    expect(recordRateLimitRejection).not.toHaveBeenCalled();
    expect(logged.records).toHaveLength(0);
  });
});
