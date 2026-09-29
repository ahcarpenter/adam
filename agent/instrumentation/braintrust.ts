import { BraintrustSpanProcessor } from "@braintrust/otel";
import { otelIntegration } from "eve/instrumentation/otel";
import { AGENT_NAME } from "#lib/agent-name";
import { parseEnv } from "#lib/env";
import { braintrustProject } from "#lib/environment";

const env = parseEnv();

// Agent traces land in Braintrust through its OpenTelemetry processor. The
// official braintrustEveInstrumentation still declares the `capture` field
// eve has removed, so eve refuses to register it; the generic OTel route
// carries turns, model calls, and tool calls as eve's GenAI spans instead.
export default otelIntegration({
  spanProcessors: [
    new BraintrustSpanProcessor({
      apiKey: env.BRAINTRUST_API_KEY,
      // Per-environment project, so local and preview turns never land in
      // the project on-call reads during an incident.
      parent: `project_name:${braintrustProject(AGENT_NAME)}`,
      // AI spans only (`gen_ai.`/`llm.`/`ai.`/`braintrust.`/`traceloop.`),
      // the agent's work rather than every HTTP request around it.
      filterAISpans: true,
    }),
  ],
});
