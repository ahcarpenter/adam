import { PostHogSpanProcessor } from "@posthog/ai/otel";
import { otelIntegration } from "eve/instrumentation/otel";
import { parseEnv } from "#lib/env";
import { attributeStep } from "#lib/step-attribution";

const env = parseEnv();

// Agent traces and generations land in PostHog LLM analytics, alongside the
// app logs in PostHog Logs. PostHog's own processor batches; a
// SimpleSpanProcessor would POST once per span, on the request path, several
// times per turn.
export default otelIntegration({
  spanProcessors: [
    new PostHogSpanProcessor({
      projectToken: env.POSTHOG_PROJECT_TOKEN,
      host: env.POSTHOG_HOST,
    }),
  ],
  // Links each model call to the authenticated user (posthog.distinct_id).
  runtimeContext: (input) => attributeStep(input.session.auth),
});
