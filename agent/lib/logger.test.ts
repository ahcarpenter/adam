import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import winston from "winston";
import TransportStream from "winston-transport";
import { configureDefaultLogger, ensureLogger } from "./logger";

const validEnv = {
  OPENAI_API_KEY: "sk-test",
  OPENAI_MODEL: "gpt-5",
  UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "token",
  BRAINTRUST_API_KEY: "key",
  POSTHOG_PROJECT_TOKEN: "phc_token",
};

function defaultTransports(): unknown[] {
  return (winston as unknown as { default: { transports: unknown[] } }).default
    .transports;
}

class MemoryTransport extends TransportStream {
  public readonly records: Record<string, unknown>[] = [];

  override log(info: Record<string, unknown>, callback: () => void): void {
    this.records.push(info);
    callback();
  }
}

function lastRecordOf(transport: MemoryTransport): Record<string, unknown> {
  const record = transport.records.at(-1);
  if (!record) throw new Error("no log records captured");
  return record;
}

describe("configureDefaultLogger", () => {
  let memory: MemoryTransport;

  beforeEach(() => {
    memory = new MemoryTransport();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("configures winston's default logger with structured JSON output", () => {
    configureDefaultLogger({ extraTransports: [memory] });
    winston.info("tool executed", { toolName: "search", durationMs: 12 });

    const record = lastRecordOf(memory);
    expect(record.level).toBe("info");
    expect(record.message).toBe("tool executed");
    expect(record.toolName).toBe("search");
    expect(record.durationMs).toBe(12);
    expect(record.timestamp).toEqual(expect.any(String));
  });

  it("respects the level option", () => {
    configureDefaultLogger({ level: "warn", extraTransports: [memory] });
    winston.info("dropped");
    winston.warn("kept");

    expect(memory.records).toHaveLength(1);
    expect(lastRecordOf(memory).message).toBe("kept");
  });

  it("falls back to LOG_LEVEL, then to info", () => {
    vi.stubEnv("LOG_LEVEL", "error");
    configureDefaultLogger({ extraTransports: [memory] });
    winston.warn("dropped");
    winston.error("kept");
    expect(memory.records).toHaveLength(1);

    vi.unstubAllEnvs();
    delete process.env.LOG_LEVEL;
    configureDefaultLogger({ extraTransports: [memory] });
    winston.info("visible at default level");
    expect(lastRecordOf(memory).message).toBe("visible at default level");
  });

  it("defaults to a single console transport when no extras are given", () => {
    const configureSpy = vi.spyOn(winston, "configure");
    configureDefaultLogger();

    const transports = configureSpy.mock.calls.at(-1)?.[0]?.transports;
    expect(Array.isArray(transports)).toBe(true);
    expect(transports).toHaveLength(1);
    expect((transports as TransportStream[])[0]).toBeInstanceOf(
      winston.transports.Console,
    );
    configureSpy.mockRestore();
  });

  it("serializes errors with stack traces", () => {
    configureDefaultLogger({ extraTransports: [memory] });
    winston.error(new Error("boom"));

    const record = lastRecordOf(memory);
    expect(record.message).toBe("boom");
    expect(record.stack).toEqual(expect.stringContaining("Error: boom"));
  });
});

describe("ensureLogger", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is a no-op when the default logger already has transports", () => {
    const memory = new MemoryTransport();
    configureDefaultLogger({ extraTransports: [memory] });
    ensureLogger();
    expect(defaultTransports()).toHaveLength(2);
    winston.info("still captured");
    expect(memory.records.at(-1)?.message).toBe("still captured");
  });

  it("configures console plus OTel bridge when the environment is complete", () => {
    for (const [key, value] of Object.entries(validEnv)) vi.stubEnv(key, value);
    winston.configure({ transports: [] });
    ensureLogger();
    expect(defaultTransports()).toHaveLength(2);
  });

  it("falls back to console-only logging on incomplete environment", () => {
    winston.configure({ transports: [] });
    ensureLogger();
    expect(defaultTransports()).toHaveLength(1);
    expect(defaultTransports()[0]).toBeInstanceOf(winston.transports.Console);
  });
});
