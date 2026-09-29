import { otel } from "eve/instrumentation/otel";

// Process-wide OpenTelemetry settings, shared by every destination in this
// directory (posthog.ts, otlp.ts) and by eve's own Agent Runs destination.
export default otel({
  // Wraps each inbound channel HTTP request in a low-cardinality SERVER span
  // (route template + method only: no session ids, tokens, or bodies) that
  // the turn trace links to. PostHog's processor drops it, forwarding only
  // AI spans; Agent Runs on Vercel and the OTLP collector (otlp.ts) are what
  // give it, and every other non-AI span, a destination.
  traceChannelRequests: true,
});
