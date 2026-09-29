import { agentRuns } from "eve/instrumentation/otel";

// Attributes that name the user: eve's principal ids, the memory store id
// (a principal-scoped memory key embeds the principal id), and every
// app-authored runtime-context value (posthog.ts stamps the user's
// principal id there as posthog_distinct_id).
const IDENTIFYING_ATTRIBUTES = new Set([
  "agent.principal.current.id",
  "agent.principal.initiator.id",
  "gen_ai.memory.store.id",
]);
const AUTHORED_RUNTIME_CONTEXT = "ai.settings.context.";
const EVE_RUNTIME_CONTEXT = "ai.settings.context.eve.";

function identifiesUser(key: string): boolean {
  return (
    IDENTIFYING_ATTRIBUTES.has(key) ||
    (key.startsWith(AUTHORED_RUNTIME_CONTEXT) &&
      !key.startsWith(EVE_RUNTIME_CONTEXT))
  );
}

// Vercel Agent Runs gets operational metadata only: no message content and
// no user identifiers. The process-wide tracePolicy in otel.ts records full
// inputs and outputs for Braintrust, PostHog, and the OTLP collector, and
// posthog.ts links spans to the user; this strips both from the copy eve
// sends to Agent Runs. Model, token counts, timing, span names, status, and
// eve's own opaque run and session ids (Agent Runs groups traces by them)
// stay. Redaction narrows only this destination.
export default agentRuns({
  exportPolicy: {
    span: () => ({ redact: true, inputs: true, outputs: true }),
    attribute: ({ key }) => ({ emit: !identifiesUser(key) }),
  },
});
