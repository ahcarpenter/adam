import { BraintrustExporter } from "@braintrust/otel";
import { registerOTel } from "@vercel/otel";
import { defineInstrumentation } from "eve/instrumentation";
import winston from "winston";
import { parseEnv } from "./lib/env";
import { ensureLogger } from "./lib/logger";

export default defineInstrumentation({
  setup: ({ agentName }) => {
    // Logs: JSON console + OTel bridge to PostHog, configured per process by
    // ensureLogger() (hooks and tools bootstrap themselves the same way, as
    // the eve runtime runs them in separate workers).
    ensureLogger();

    try {
      parseEnv();
    } catch (error) {
      // Production fails fast on a bad environment; local dev degrades
      // (console-only logs, no trace export) so the agent stays runnable
      // without PostHog/Braintrust/Upstash credentials.
      if (
        process.env.NODE_ENV === "production" ||
        process.env.VERCEL_ENV === "production"
      ) {
        throw error;
      }
      winston.warn("trace export disabled: incomplete environment", {
        detail: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    // Traces: only AI spans reach Braintrust (BRAINTRUST_API_KEY read by the
    // exporter). Non-AI spans are dropped by filterAISpans.
    registerOTel({
      serviceName: agentName,
      traceExporter: new BraintrustExporter({
        parent: `project_name:${agentName}`,
        filterAISpans: true,
      }),
    });
  },
});
