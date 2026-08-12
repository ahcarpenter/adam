import { SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { PostHogTraceExporter } from "@posthog/ai/otel";
import { registerOTel } from "@vercel/otel";
import { braintrustEveInstrumentation, initLogger } from "braintrust";
import { defineState } from "eve/context";
import { defineInstrumentation } from "eve/instrumentation";
import { parseEnv } from "./lib/env";
import { ensureLogger } from "./lib/logger";
import {
  attributeStep,
  type EarlierStepStartedResult,
} from "./lib/step-attribution";

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

// Braintrust vendors a narrower copy of eve's step.started event input (no
// session.auth, array-shaped instructions); the runtime value is eve's real
// event either way. This alias marks the one point where the two type worlds
// disagree — the only casts in the file sit in the handler below.
type BraintrustStepStartedInput = Parameters<
  NonNullable<NonNullable<typeof braintrust.events>["step.started"]>
>[0];

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

    // Fail fast on an incomplete environment — in every mode, local dev
    // included (no degraded console-only fallback).
    const env = parseEnv();

    // Braintrust-native capture (initLogger).
    braintrust.setup?.(context);

    // Agent traces and generations land in PostHog LLM analytics,
    // alongside the app logs in PostHog Logs.
    registerOTel({
      serviceName: context.agentName,
      spanProcessors: [
        new SimpleSpanProcessor(
          new PostHogTraceExporter({
            projectToken: env.POSTHOG_PROJECT_TOKEN,
            host: env.POSTHOG_HOST,
          }),
        ),
      ],
    });
  },
  events: {
    ...braintrust.events,
    "step.started"(input) {
      // Braintrust's handler runs first (durable LLM input capture); PostHog
      // user attribution is layered on top of its runtime context.
      return attributeStep(
        input.session.auth,
        braintrust.events?.["step.started"]?.(
          input as BraintrustStepStartedInput,
        ) as EarlierStepStartedResult | undefined,
      );
    },
  },
});
