import { BraintrustExporter } from "@braintrust/otel";
import { trace } from "@opentelemetry/api";
import {
  BatchSpanProcessor,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { PostHogTraceExporter } from "@posthog/ai/otel";
import { registerOTel } from "@vercel/otel";
import { defineInstrumentation } from "eve/instrumentation";
import winston from "winston";
import { parseEnv } from "./lib/env";
import { ensureLogger } from "./lib/logger";

export default defineInstrumentation({
  setup: ({ agentName }) => {
    // Logs: JSON console + OTel bridge to PostHog Logs, configured per
    // process by ensureLogger() (the eve runtime runs authored modules in
    // separate workers, so each bootstraps itself).
    ensureLogger();

    let posthog: { host: string; token: string };
    try {
      const env = parseEnv();
      posthog = { host: env.POSTHOG_HOST, token: env.POSTHOG_PROJECT_TOKEN };
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

    registerOTel({
      serviceName: agentName,
      spanProcessors: [
        // Only AI spans reach Braintrust (BRAINTRUST_API_KEY read by the
        // exporter); filterAISpans drops the rest.
        new BatchSpanProcessor(
          new BraintrustExporter({
            parent: `project_name:${agentName}`,
            filterAISpans: true,
          }),
        ),
        // Agent traces and generations land in PostHog LLM analytics,
        // alongside the app logs in PostHog Logs.
        new SimpleSpanProcessor(
          new PostHogTraceExporter({
            projectToken: posthog.token,
            host: posthog.host,
          }),
        ),
      ],
    });
  },
  events: {
    // Links spans (and PostHog analytics) to the authenticated user.
    "step.started"(input) {
      const distinctId =
        input.session.auth.initiator?.principalId ??
        input.session.auth.current?.principalId;

      if (!distinctId) return undefined;

      trace.getActiveSpan()?.setAttribute("posthog.distinct_id", distinctId);
      return { runtimeContext: { posthog_distinct_id: distinctId } };
    },
  },
});
