import { metrics } from "@opentelemetry/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validEnv } from "./env.fixtures";

const meterProvider = vi.hoisted(() => vi.fn());
const metricReader = vi.hoisted(() => vi.fn());
const metricExporter = vi.hoisted(() => vi.fn());

// The SDK is the network boundary: mocking it keeps the tests from starting
// a real export loop while still asserting how the provider is assembled.
vi.mock("@opentelemetry/sdk-metrics", () => ({
  MeterProvider: meterProvider,
  PeriodicExportingMetricReader: metricReader,
}));
vi.mock("@opentelemetry/exporter-metrics-otlp-http", () => ({
  OTLPMetricExporter: metricExporter,
}));

const counters = new Map<string, { add: ReturnType<typeof vi.fn> }>();
const histograms = new Map<string, { record: ReturnType<typeof vi.fn> }>();

function counter(name: string) {
  const existing = counters.get(name);
  if (!existing) throw new Error(`no counter named ${name}`);
  return existing;
}

function recordingMeter() {
  return {
    createCounter: vi.fn((name: string) => {
      const instrument = { add: vi.fn() };
      counters.set(name, instrument);
      return instrument;
    }),
    createHistogram: vi.fn((name: string) => {
      const instrument = { record: vi.fn() };
      histograms.set(name, instrument);
      return instrument;
    }),
  };
}

async function loadMetrics(env: Record<string, string> = validEnv) {
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  vi.resetModules();
  return await import("./metrics");
}

describe("metrics", () => {
  let meter: ReturnType<typeof recordingMeter>;

  beforeEach(() => {
    counters.clear();
    histograms.clear();
    meterProvider.mockClear();
    metricReader.mockClear();
    metricExporter.mockClear();
    meter = recordingMeter();
    vi.spyOn(metrics, "getMeter").mockReturnValue(
      meter as unknown as ReturnType<typeof metrics.getMeter>,
    );
    vi.spyOn(metrics, "setGlobalMeterProvider").mockReturnValue(true);
  });

  afterEach(() => {
    process.removeAllListeners("beforeExit");
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe("ensureMetrics", () => {
    it("stays off without an OTLP endpoint", async () => {
      const { ensureMetrics } = await loadMetrics();
      ensureMetrics();

      expect(meterProvider).not.toHaveBeenCalled();
      expect(metrics.setGlobalMeterProvider).not.toHaveBeenCalled();
    });

    it("registers a periodic reader when an endpoint is configured", async () => {
      const { ensureMetrics } = await loadMetrics({
        ...validEnv,
        OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.example.com",
      });
      ensureMetrics();

      expect(metricReader).toHaveBeenCalledWith({
        exporter: expect.any(metricExporter),
      });
      expect(meterProvider).toHaveBeenCalledWith({
        resource: expect.objectContaining({
          attributes: expect.objectContaining({ "service.name": "adam" }),
        }),
        readers: [expect.any(metricReader)],
      });
      expect(metrics.setGlobalMeterProvider).toHaveBeenCalledTimes(1);
    });

    it("bootstraps once per process", async () => {
      const { ensureMetrics } = await loadMetrics({
        ...validEnv,
        OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.example.com",
      });
      ensureMetrics();
      ensureMetrics();

      expect(meterProvider).toHaveBeenCalledTimes(1);
    });

    it("throws on an incomplete environment", async () => {
      const { ensureMetrics } = await loadMetrics({});
      expect(() => ensureMetrics()).toThrow(/Invalid environment/);
    });

    it("stays retryable after a throw instead of latching off", async () => {
      const { ensureMetrics } = await loadMetrics({});
      expect(() => ensureMetrics()).toThrow(/Invalid environment/);

      for (const [key, value] of Object.entries(validEnv)) {
        vi.stubEnv(key, value);
      }
      vi.stubEnv(
        "OTEL_EXPORTER_OTLP_ENDPOINT",
        "https://collector.example.com",
      );
      ensureMetrics();

      expect(meterProvider).toHaveBeenCalledTimes(1);
    });
  });

  describe("recordTurn", () => {
    it("counts the turn and records its duration", async () => {
      const { recordTurn } = await loadMetrics();
      recordTurn("completed", "channel:eve", 12.5);

      expect(counter("agent.turns").add).toHaveBeenCalledWith(1, {
        outcome: "completed",
        channel_kind: "channel:eve",
      });
      expect(
        histograms.get("agent.turn.duration")?.record,
      ).toHaveBeenCalledWith(12.5, {
        outcome: "completed",
        channel_kind: "channel:eve",
      });
    });

    it("counts a turn whose duration is unknown", async () => {
      const { recordTurn } = await loadMetrics();
      recordTurn("failed", "unknown");

      expect(counter("agent.turns").add).toHaveBeenCalledTimes(1);
      expect(meter.createHistogram).not.toHaveBeenCalled();
    });

    it("creates each instrument once", async () => {
      const { recordTurn } = await loadMetrics();
      recordTurn("completed", "http", 1);
      recordTurn("completed", "http", 2);

      expect(meter.createCounter).toHaveBeenCalledTimes(1);
      expect(meter.createHistogram).toHaveBeenCalledTimes(1);
      expect(counter("agent.turns").add).toHaveBeenCalledTimes(2);
    });
  });

  it("records tool calls by tool and status", async () => {
    const { recordToolCall } = await loadMetrics();
    recordToolCall("agentkit__recall_memory", "failed");

    expect(counter("agent.tool_calls").add).toHaveBeenCalledWith(1, {
      tool: "agentkit__recall_memory",
      status: "failed",
    });
  });

  it("records rate-limit rejections without attributes", async () => {
    const { recordRateLimitRejection } = await loadMetrics();
    recordRateLimitRejection();

    expect(counter("agent.rate_limit.rejections").add).toHaveBeenCalledWith(1);
  });
});
