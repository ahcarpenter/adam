import { agentRuns } from "eve/instrumentation/otel";

// Vercel Agent Runs gets span metadata only. The process-wide tracePolicy in
// otel.ts records full inputs and outputs for Braintrust, PostHog, and the
// OTLP collector; this strips that content from the copy eve sends to Agent
// Runs, so the Vercel project's Observability view never holds what users
// type or what the model replies. Redaction narrows only this destination.
export default agentRuns({
  exportPolicy: {
    span: () => ({ redact: true, inputs: true, outputs: true }),
  },
});
