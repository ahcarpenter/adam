import { otel } from "eve/instrumentation/otel";

// Process-wide OpenTelemetry settings, shared by every destination in this
// directory (braintrust.ts, posthog.ts, otlp.ts, agent-runs.ts).
export default otel({
  // Wraps each inbound channel HTTP request in a low-cardinality SERVER span
  // (route template + method only: no session ids, tokens, or bodies) that
  // the turn trace links to. PostHog and Braintrust keep only AI spans; Agent
  // Runs on Vercel and the OTLP collector (otlp.ts) are what give it, and
  // every other non-AI span, a destination.
  traceChannelRequests: true,
  // Stated rather than inherited: full message history and model output ride
  // on every model-call span, to Braintrust, PostHog, and the OTLP collector,
  // in every environment and for every audience (agent-runs.ts strips it
  // back out for Vercel Agent Runs). eve's default would keep content
  // only in development and for public conversations. eve also caps content
  // for non-public conversations outside development after this policy runs,
  // which is why agent/channels/eve.ts classifies every conversation public.
  // That content is the debugging the boilerplate is built around, and it
  // means those destinations hold whatever your users type. Set both to false
  // before pointing this at regulated or otherwise sensitive traffic.
  tracePolicy: () => ({ emit: true, recordInputs: true, recordOutputs: true }),
});
