import { otel } from "eve/instrumentation/otel";

// Process-wide OpenTelemetry settings, shared by every destination in this
// directory (braintrust.ts, posthog.ts, otlp.ts, agent-runs.ts).
export default otel({
  // Off because of a fault in eve, not by preference. true wraps each inbound
  // channel HTTP request in a low-cardinality SERVER span (route template +
  // method only: no session ids, tokens, or bodies) that the turn trace links
  // to, and Agent Runs on Vercel and the OTLP collector (otlp.ts) are its
  // destinations. eve ends that span when the handler returns, so on a
  // streamed response (GET /eve/v1/session/:id/stream) the spans started
  // while the body is read are children of a span that has already ended.
  // eve's bundled @vercel/otel then takes the first of them for the trace's
  // root and, when it ends, ends the others still open, which later end
  // themselves: "You can only call end() on a span once", logged at error
  // on every stream request, with a wrong duration on the span ended early.
  // Without the request span each of those spans is its own trace and none
  // is ended twice. Seen on eve 0.68.0 and unchanged in 0.69.0. Set it back
  // to true once an eve release keeps the request span open until the
  // response body finishes, or stops treating a span that has a parent as a
  // root; a stream request that logs no such line is the check.
  traceChannelRequests: false,
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
