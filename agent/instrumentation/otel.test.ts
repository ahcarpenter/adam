import { ROOT_CONTEXT } from "@opentelemetry/api";
import type {
  SpanProcessor,
  TraceCaptureContext,
} from "eve/instrumentation/otel";
import { describe, expect, it, vi } from "vitest";

const agentRunsExport = vi.hoisted(() => ({
  exported: [] as { name: string; attributes: Record<string, unknown> }[],
}));

// Agent Runs' real downstream is Vercel's request-context transport, which
// only exists on a deployment. This routes the same declared options through
// eve's own export-policy pipeline into a recorder instead, so the test sees
// exactly what Agent Runs would receive.
vi.mock("eve/instrumentation/otel", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("eve/instrumentation/otel")>();
  const recorder: SpanProcessor = {
    onStart: () => {},
    onEnd: (span: { name: string; attributes: Record<string, unknown> }) => {
      agentRunsExport.exported.push({
        name: span.name,
        attributes: { ...span.attributes },
      });
    },
    forceFlush: async () => {},
    shutdown: async () => {},
  };
  return {
    ...actual,
    agentRuns: (options: Parameters<typeof actual.agentRuns>[0]) =>
      actual.otelIntegration({ ...options, spanProcessors: [recorder] }),
  };
});

const { default: declaration } = await import("./otel");
const { default: agentRuns } = await import("./agent-runs");

const environments = ["development", "preview", "production"] as const;
const audiences = ["public", "private", "unknown"] as const;

// Content capture is a data-flow decision (docs/observability.md,
// SECURITY.md), so it is pinned here rather than left to eve's
// audience-aware default, which a dropped or edited policy would restore
// without any other signal.
describe("otel trace policy", () => {
  it.each(
    environments.flatMap((environment) =>
      audiences.map((audience) => ({ environment, audience })),
    ),
  )(
    "records inputs and outputs in $environment for $audience conversations",
    ({ environment, audience }) => {
      const trace: TraceCaptureContext = {
        agentName: "adam",
        audience,
        channel: { kind: "channel:eve" },
        environment,
        principalType: "user",
      };

      expect(declaration.options.tracePolicy?.(trace)).toEqual({
        emit: true,
        recordInputs: true,
        recordOutputs: true,
      });
    },
  );
});

// The policy above admits full content to every destination; Agent Runs is
// the one that must receive metadata only.
describe("Agent Runs export", () => {
  it.each(audiences)(
    "keeps the span but strips inputs and outputs for %s conversations",
    (audience) => {
      agentRunsExport.exported.length = 0;
      const span = {
        name: "chat gpt-5",
        attributes: {
          "agent.channel.audience": audience,
          "gen_ai.operation.name": "chat",
          "gen_ai.request.model": "gpt-5",
          "gen_ai.usage.input_tokens": 12,
          "gen_ai.input.messages": '[{"role":"user","content":"hi"}]',
          "gen_ai.system_instructions": "You are adam.",
          "gen_ai.output.messages": '[{"role":"assistant","content":"hello"}]',
          "ai.prompt": "hi",
          "ai.response.text": "hello",
        },
        events: [],
        status: { code: 0 },
        spanContext: () => ({
          traceId: "t".repeat(32),
          spanId: "s".repeat(16),
        }),
      };

      for (const processor of agentRuns.spanProcessors) {
        if (typeof processor === "string") continue;
        processor.onStart(span as never, ROOT_CONTEXT);
        processor.onEnd(span as never);
      }

      expect(agentRunsExport.exported).toEqual([
        {
          name: "chat gpt-5",
          attributes: {
            "agent.channel.audience": audience,
            "gen_ai.operation.name": "chat",
            "gen_ai.request.model": "gpt-5",
            "gen_ai.usage.input_tokens": 12,
          },
        },
      ]);
    },
  );
});
