import { otel } from "eve/instrumentation/otel";

// Process-wide OpenTelemetry settings, shared by every destination in this
// directory (braintrust.ts, posthog.ts, otlp.ts, agent-runs.ts).
export default otel({
  // Off by choice, as is eve's own default since 0.83.3. true wraps each
  // inbound channel HTTP request in a low-cardinality SERVER span (route
  // template + method only: no session ids, tokens, or bodies) that the turn
  // trace links to, and Agent Runs on Vercel and the OTLP collector
  // (otlp.ts) are its destinations. eve 0.83.3 also fixed the fault that
  // kept it off before: a streamed response's spans were ended twice, logging
  // "You can only call end() on a span once" on every stream request. Turn
  // it on when request-level spans are wanted; a stream request that logs no
  // such line is the check.
  traceChannelRequests: false,
  // Stated rather than inherited: full message history and model output ride
  // on every model-call span, to Braintrust, PostHog, and the OTLP collector,
  // in every environment and for every audience (agent-runs.ts strips it
  // back out for Vercel Agent Runs). eve's default would keep content
  // only in development and for public conversations; an explicit policy
  // like this one is honored for every audience. The caller's principal ids
  // still reach a span only for public conversations outside development,
  // which is why agent/channels/eve.ts classifies every conversation public.
  // That content is the debugging the boilerplate is built around, and it
  // means those destinations hold whatever your users type. Set both to false
  // before pointing this at regulated or otherwise sensitive traffic.
  tracePolicy: () => ({ emit: true, recordInputs: true, recordOutputs: true }),
});
