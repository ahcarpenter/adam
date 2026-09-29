import { defineInstrumentation } from "eve/instrumentation";
import { parseEnv } from "#lib/env";
import { ensureLogger } from "#lib/logger";
import { ensureMetrics } from "#lib/metrics";
import { reportServiceNameDrift } from "#lib/resource";

// No events: this file exists for its setup, the one place eve hands the
// agent name it resolved to authored code.
export default defineInstrumentation({
  setup: ({ agentName }) => {
    // The eve runtime runs authored modules in separate workers, so each
    // process bootstraps its own logger and meter.
    ensureLogger();
    ensureMetrics();

    // Fail fast on an incomplete environment, in every mode, local dev
    // included (no degraded console-only fallback).
    const env = parseEnv();

    // The one place both names exist: workers name logs and metrics from the
    // environment, only this callback learns what eve resolved.
    reportServiceNameDrift(env.OTEL_SERVICE_NAME, agentName);
  },
});
