import { type Counter, type Histogram, metrics } from "@opentelemetry/api";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import {
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import { ensureOtelDiagnostics } from "./diagnostics";
import { parseEnv } from "./env";
import { telemetryResource } from "./resource";
import { flushOnExit } from "./shutdown";

/**
 * Turn latency in seconds. The default histogram buckets are tuned for
 * millisecond HTTP handlers and would put every agent turn in the overflow
 * bucket, making p95 unreadable.
 */
const turnDurationBuckets = [0.5, 1, 2, 5, 10, 20, 30, 60, 120, 300];

let started = false;

/**
 * Self-configuring bootstrap, matching ensureLogger(): each eve worker
 * process registers its own meter provider once.
 *
 * No-op without OTEL_EXPORTER_OTLP_ENDPOINT. Neither PostHog nor Braintrust
 * ingests OTLP metrics, so there is no destination by default; until one is
 * configured the global provider stays the API's no-op and every record()
 * below costs nothing. The exporter reads the endpoint from the environment
 * itself, per the OTLP specification.
 */
export function ensureMetrics(): void {
  if (started) return;

  // Flagged only once the environment has parsed: latching before it would
  // leave a process whose first call threw permanently unmetered.
  const env = parseEnv();
  started = true;
  if (!env.OTEL_EXPORTER_OTLP_ENDPOINT) return;

  ensureOtelDiagnostics();
  const provider = new MeterProvider({
    resource: telemetryResource(env.OTEL_SERVICE_NAME),
    readers: [
      new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter() }),
    ],
  });
  metrics.setGlobalMeterProvider(provider);
  flushOnExit(provider);
}

// Instruments are created on first use, not at import: a meter resolved
// before ensureMetrics() runs binds to the no-op provider permanently.
let turnCounter: Counter | undefined;
let turnDuration: Histogram | undefined;
let toolCallCounter: Counter | undefined;
let rateLimitCounter: Counter | undefined;

function meter() {
  return metrics.getMeter("adam.agent");
}

/** Terminal outcome of one turn. Cancellation is neither of the other two. */
export type TurnOutcome = "completed" | "failed" | "cancelled";

/**
 * RED for turns: rate and errors from the counter, duration from the
 * histogram. Attributes stay closed sets — outcome is three values and
 * channel kind is eve's own enumeration — so the series count is bounded.
 * Session, turn, and user ids belong in logs and traces, never here.
 *
 * Keys are dotted and namespaced under `agent.`, matching the instrument
 * names. Not `eve.`, which the runtime reserves for the attributes it sets
 * itself.
 */
export function recordTurn(
  outcome: TurnOutcome,
  channelKind: string,
  durationSeconds?: number,
): void {
  const attributes = {
    "agent.turn.outcome": outcome,
    "agent.channel.kind": channelKind,
  };
  turnCounter ??= meter().createCounter("agent.turns", {
    description: "Turns by terminal outcome.",
  });
  turnCounter.add(1, attributes);

  if (durationSeconds === undefined) return;
  turnDuration ??= meter().createHistogram("agent.turn.duration", {
    description: "Wall-clock duration of one turn.",
    unit: "s",
    advice: { explicitBucketBoundaries: turnDurationBuckets },
  });
  turnDuration.record(durationSeconds, attributes);
}

/** RED for tool calls. `tool` is bounded by the agent's tool set. */
export function recordToolCall(tool: string, status: string): void {
  toolCallCounter ??= meter().createCounter("agent.tool_calls", {
    description: "Tool calls by tool and result status.",
  });
  toolCallCounter.add(1, {
    "agent.tool.name": tool,
    "agent.tool.status": status,
  });
}

/**
 * Throttled callers. Deliberately unlabelled: the only distinguishing value
 * available is the caller's address, which is exactly the unbounded label
 * that melts a metrics backend. Use the paired log line to identify callers.
 */
export function recordRateLimitRejection(): void {
  rateLimitCounter ??= meter().createCounter("agent.rate_limit.rejections", {
    description: "Requests rejected by the channel rate limit.",
  });
  rateLimitCounter.add(1);
}
