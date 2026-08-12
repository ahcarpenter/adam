import { trace } from "@opentelemetry/api";
import { SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { PostHogTraceExporter } from "@posthog/ai/otel";
import { registerOTel } from "@vercel/otel";
import { braintrustEveInstrumentation, initLogger } from "braintrust";
import { defineState } from "eve/context";
import { defineInstrumentation } from "eve/instrumentation";
import winston from "winston";
import { parseEnv } from "./lib/env";
import { ensureLogger } from "./lib/logger";

// Official Braintrust eve integration as the base: native capture of turns,
// steps, tool calls, and subagent interactions (with agent/hooks/braintrust.ts),
// plus durable LLM input capture via defineState.
const braintrust = braintrustEveInstrumentation({
  defineState,
  setup: ({ agentName }) => {
    initLogger({
      projectName: agentName,
      apiKey: process.env.BRAINTRUST_API_KEY,
    });
  },
});

export default defineInstrumentation({
  // Preserves recordInputs/recordOutputs and any future wrapper fields.
  ...braintrust,
  // Wraps each inbound channel HTTP request in a low-cardinality SERVER span
  // (route template + method only — no session ids, tokens, or bodies) that
  // parents the turn trace, giving PostHog request-level visibility.
  traceChannelRequests: true,
  setup: (context) => {
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

    // Braintrust-native capture (initLogger).
    braintrust.setup?.(context);

    // Agent traces and generations land in PostHog LLM analytics,
    // alongside the app logs in PostHog Logs.
    registerOTel({
      serviceName: context.agentName,
      spanProcessors: [
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
    ...braintrust.events,
    "step.started"(input) {
      // Braintrust's handler first (durable LLM input capture); its vendored
      // event-input type lacks session.auth, hence the narrowing cast.
      const fromBraintrust = braintrust.events?.["step.started"]?.(
        input as never,
      );

      // Links spans (and PostHog analytics) to the authenticated user.
      const distinctId =
        input.session.auth.initiator?.principalId ??
        input.session.auth.current?.principalId;
      if (distinctId) {
        trace.getActiveSpan()?.setAttribute("posthog.distinct_id", distinctId);
      }

      const runtimeContext = {
        ...fromBraintrust?.runtimeContext,
        ...(distinctId ? { posthog_distinct_id: distinctId } : {}),
      };
      return Object.keys(runtimeContext).length > 0
        ? { runtimeContext }
        : undefined;
    },
  },
} as Parameters<typeof defineInstrumentation>[0]);
