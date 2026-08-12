import { diag } from "@opentelemetry/api";

/** The flush surface shared by the OTel log and metric providers. */
export interface FlushableProvider {
  shutdown(): Promise<void>;
}

/**
 * Drains a provider's batch queue before the process ends.
 *
 * `registerOTel` owns this for the trace pipeline, but the log and metric
 * providers are built per worker (the eve runtime runs authored modules in
 * separate processes, so no single startup call can reach them all) and
 * nothing else flushes them.
 *
 * `beforeExit` only — installing a SIGTERM/SIGINT listener would suppress
 * Node's default signal handling and race the runtime's own graceful
 * shutdown. That leaves a real residual gap: a hard kill or a frozen
 * serverless instance still discards whatever is queued, bounded by the
 * batch interval (one second for logs).
 */
export function flushOnExit(provider: FlushableProvider): void {
  process.once("beforeExit", () => {
    provider.shutdown().catch((error: unknown) => {
      diag.error("telemetry provider shutdown failed", error);
    });
  });
}
