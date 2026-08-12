import { logs } from "@opentelemetry/api-logs";
import { OpenTelemetryTransportV3 } from "@opentelemetry/winston-transport";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import winston from "winston";
import TransportStream from "winston-transport";
import { validEnv } from "./env.fixtures";
import {
  configureDefaultLogger,
  defaultTransports,
  ensureLogger,
} from "./logger";

// The OTLP exporter is the network boundary: mocking it keeps ensureLogger
// tests from constructing a real exporter aimed at PostHog while still
// asserting the exact endpoint and credentials it would be built with. The
// SDK is mocked alongside it so the provider's resource is observable.
const otlpLogExporter = vi.hoisted(() => vi.fn());
const batchProcessor = vi.hoisted(() => vi.fn());
const loggerProvider = vi.hoisted(() => vi.fn());
vi.mock("@opentelemetry/exporter-logs-otlp-http", () => ({
  OTLPLogExporter: otlpLogExporter,
}));
vi.mock("@opentelemetry/sdk-logs", () => ({
  BatchLogRecordProcessor: batchProcessor,
  LoggerProvider: loggerProvider,
}));

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

  it("defaults to info, ignoring a raw LOG_LEVEL in the environment", () => {
    // The level reaches this function through parseEnv (see ensureLogger),
    // which rejects a value winston cannot resolve.
    vi.stubEnv("LOG_LEVEL", "error");
    configureDefaultLogger({ extraTransports: [memory] });
    winston.info("visible at default level");

    expect(lastRecordOf(memory).message).toBe("visible at default level");
  });

  it("defaults to a single console transport when no extras are given", () => {
    configureDefaultLogger();

    expect(defaultTransports()).toHaveLength(1);
    expect(defaultTransports()[0]).toBeInstanceOf(winston.transports.Console);
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
  beforeEach(() => {
    otlpLogExporter.mockClear();
    batchProcessor.mockClear();
    loggerProvider.mockClear();
    // Keeps the process-global logger provider out of the test run while
    // still observing that ensureLogger registers one.
    vi.spyOn(logs, "setGlobalLoggerProvider").mockImplementation(
      (provider) => provider,
    );
  });

  afterEach(() => {
    process.removeAllListeners("beforeExit");
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("is a no-op when the default logger already has transports", () => {
    const memory = new MemoryTransport();
    configureDefaultLogger({ extraTransports: [memory] });
    ensureLogger();
    expect(defaultTransports()).toHaveLength(2);
    winston.info("still captured");
    expect(memory.records.at(-1)?.message).toBe("still captured");
  });

  it("configures console plus a PostHog OTel bridge when the environment is complete", () => {
    for (const [key, value] of Object.entries(validEnv)) vi.stubEnv(key, value);
    winston.configure({ transports: [] });
    ensureLogger();

    expect(defaultTransports()).toHaveLength(2);
    expect(defaultTransports()[1]).toBeInstanceOf(OpenTelemetryTransportV3);
    expect(otlpLogExporter).toHaveBeenCalledWith({
      url: "https://us.i.posthog.com/i/v1/logs",
      headers: { Authorization: "Bearer phc_token" },
    });
    expect(batchProcessor).toHaveBeenCalledWith({
      exporter: expect.any(otlpLogExporter),
    });
    expect(logs.setGlobalLoggerProvider).toHaveBeenCalledTimes(1);
  });

  it("names the service and environment on exported records", () => {
    for (const [key, value] of Object.entries(validEnv)) vi.stubEnv(key, value);
    vi.stubEnv("VERCEL_ENV", "preview");
    winston.configure({ transports: [] });
    ensureLogger();

    expect(loggerProvider).toHaveBeenCalledWith({
      resource: expect.objectContaining({
        attributes: {
          "service.name": "adam",
          "deployment.environment.name": "preview",
        },
      }),
      processors: [expect.any(batchProcessor)],
    });
  });

  it("takes the winston level from the validated environment", () => {
    for (const [key, value] of Object.entries(validEnv)) vi.stubEnv(key, value);
    vi.stubEnv("LOG_LEVEL", "debug");
    winston.configure({ transports: [] });
    ensureLogger();

    expect(winston.level).toBe("debug");
  });

  it("drains the provider before the process exits", () => {
    for (const [key, value] of Object.entries(validEnv)) vi.stubEnv(key, value);
    winston.configure({ transports: [] });
    const before = process.listenerCount("beforeExit");
    ensureLogger();

    expect(process.listenerCount("beforeExit")).toBe(before + 1);
  });

  it("throws on an incomplete environment", () => {
    vi.stubEnv("BRAINTRUST_API_KEY", undefined);
    winston.configure({ transports: [] });
    expect(() => ensureLogger()).toThrow(/Invalid environment/);
    expect(defaultTransports()).toHaveLength(0);
    expect(otlpLogExporter).not.toHaveBeenCalled();
    expect(logs.setGlobalLoggerProvider).not.toHaveBeenCalled();
  });
});
