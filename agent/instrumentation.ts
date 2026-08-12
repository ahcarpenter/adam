import { PostHogSpanProcessor } from "@posthog/ai/otel";
import { registerOTel } from "@vercel/otel";
import { braintrustEveInstrumentation, initLogger } from "braintrust";
import { defineState } from "eve/context";
import { defineInstrumentation } from "eve/instrumentation";
import { parseEnv } from "./lib/env";
import { braintrustProject } from "./lib/environment";
import { ensureLogger } from "./lib/logger";
import { ensureMetrics } from "./lib/metrics";
import { reportServiceNameDrift } from "./lib/resource";
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
      // Per-environment project, so local and preview turns never land in
      // the project on-call reads during an incident.
      projectName: braintrustProject(agentName),
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
  // Stated rather than inherited: full message history and model output ride
  // on every step span, to Braintrust and to PostHog. That is the debugging
  // the boilerplate is built around, and it means both vendors hold whatever
  // your users type. Set both to false before pointing this at regulated or
  // otherwise sensitive traffic.
  recordInputs: true,
  recordOutputs: true,
  // Wraps each inbound channel HTTP request in a low-cardinality SERVER span
  // (route template + method only — no session ids, tokens, or bodies) that
  // parents the turn trace. PostHog's exporter drops it, forwarding only AI
  // spans (`gen_ai.`/`llm.`/`ai.`/`traceloop.` prefixes); the "auto"
  // processor below is what gives it, and every other non-AI span, a
  // destination.
  traceChannelRequests: true,
  setup: (context) => {
    // The eve runtime runs authored modules in separate workers, so each
    // process bootstraps its own logger and meter.
    ensureLogger();
    ensureMetrics();

    // Fail fast on an incomplete environment — in every mode, local dev
    // included (no degraded console-only fallback).
    const env = parseEnv();

    // The one place both names exist: workers name logs and metrics from the
    // environment, only this callback learns what eve resolved.
    reportServiceNameDrift(env.OTEL_SERVICE_NAME, context.agentName);

    braintrust.setup?.(context);

    // Agent traces and generations land in PostHog LLM analytics,
    // alongside the app logs in PostHog Logs. PostHog's own processor
    // batches; a SimpleSpanProcessor would POST once per span, on the
    // request path, several times per turn.
    //
    // "auto" keeps @vercel/otel's default export mechanism alongside it —
    // naming any processor otherwise replaces it. It is the only path that
    // accepts non-AI spans (channel requests, hook.resume, outgoing HTTP):
    // Vercel's tracing integration when one is installed on the project,
    // otherwise an OTLP exporter configured from OTEL_EXPORTER_OTLP_*, which
    // means setting OTEL_EXPORTER_OTLP_ENDPOINT for metrics also sends every
    // span to that collector.
    registerOTel({
      serviceName: context.agentName,
      spanProcessors: [
        new PostHogSpanProcessor({
          projectToken: env.POSTHOG_PROJECT_TOKEN,
          host: env.POSTHOG_HOST,
        }),
        "auto",
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
