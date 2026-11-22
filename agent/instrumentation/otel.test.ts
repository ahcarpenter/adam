import { ROOT_CONTEXT } from "@opentelemetry/api";
import type {
  SpanProcessor,
  TraceCaptureContext,
} from "eve/instrumentation/otel";
import { describe, expect, it, vi } from "vitest";

type ExportedSpan = { name: string; attributes: Record<string, unknown> };

const recorded = vi.hoisted(() => {
  const record =
    (into: ExportedSpan[]) =>
    (span: { name: string; attributes: Record<string, unknown> }) => {
      into.push({ name: span.name, attributes: { ...span.attributes } });
    };
  const destinations = {
    agentRuns: [] as ExportedSpan[],
    posthog: [] as ExportedSpan[],
    braintrust: [] as ExportedSpan[],
  };
  const posthogOptions: unknown[] = [];
  const processorFor = (into: ExportedSpan[], options?: unknown[]) =>
    class {
      constructor(received?: unknown) {
        options?.push(received);
      }
      onStart() {}
      onEnd = record(into);
      async forceFlush() {}
      async shutdown() {}
    };
  return {
    destinations,
    posthogOptions,
    PostHogSpanProcessor: processorFor(destinations.posthog, posthogOptions),
    BraintrustSpanProcessor: processorFor(destinations.braintrust),
    agentRunsRecorder: new (processorFor(destinations.agentRuns))(),
  };
});

vi.mock("#lib/env", () => ({
  parseEnv: () => ({
    BRAINTRUST_API_KEY: "test",
    POSTHOG_HOST: "https://posthog.test",
    POSTHOG_PROJECT_TOKEN: "test",
  }),
}));
// The vendor processors are swapped for recorders so the test sees what
// posthog.ts and braintrust.ts hand their exporters, without a network call.
vi.mock("@posthog/ai/otel", () => ({
  PostHogSpanProcessor: recorded.PostHogSpanProcessor,
}));
vi.mock("@braintrust/otel", () => ({
  BraintrustSpanProcessor: recorded.BraintrustSpanProcessor,
}));

// Agent Runs' real downstream is Vercel's request-context transport, which
// only exists on a deployment. This routes the same declared options through
// eve's own export-policy pipeline into a recorder instead, so the test sees
// exactly what Agent Runs would receive.
vi.mock("eve/instrumentation/otel", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("eve/instrumentation/otel")>();
  const recorder = recorded.agentRunsRecorder as unknown as SpanProcessor;
  return {
    ...actual,
    agentRuns: (options: Parameters<typeof actual.agentRuns>[0]) =>
      actual.otelIntegration({ ...options, spanProcessors: [recorder] }),
  };
});

const { default: declaration } = await import("./otel");
const destinations = {
  agentRuns: (await import("./agent-runs")).default,
  posthog: (await import("./posthog")).default,
  braintrust: (await import("./braintrust")).default,
};

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

// With the request span on, eve 0.68.0 and 0.69.0 end the spans of a streamed
// response twice: it ends the request span when the handler returns, its
// bundled @vercel/otel takes the first span started while the body is read
// for the trace's root, and ending that one ends the others still open
// before they end themselves. Every stream request then logs "You can only
// call end() on a span once" at error. The fault is in eve, so the only
// thing adam can pin is the setting that sets it off. Turn it back on, and
// change this test, once an eve release fixes it.
describe("otel request spans", () => {
  it("stay off while eve ends a streamed response's spans twice", () => {
    expect(declaration.options.traceChannelRequests).toBe(false);
  });
});

// The policy above admits full content and user identity to every
// destination; Agent Runs is the one that must receive operational metadata
// only, while PostHog and Braintrust keep all of it.
const operational = {
  "gen_ai.operation.name": "chat",
  "gen_ai.request.model": "openai/gpt-5",
  "gen_ai.usage.input_tokens": 12,
  "agent.principal.current.type": "user",
  "agent.run.id": "run_1",
  "gen_ai.conversation.id": "conv_1",
  "ai.settings.context.eve.turn.id": "turn_1",
};
const content = {
  "gen_ai.input.messages": '[{"role":"user","content":"hi"}]',
  "gen_ai.system_instructions": "You are adam.",
  "gen_ai.output.messages": '[{"role":"assistant","content":"hello"}]',
  "ai.prompt": "hi",
  "ai.response.text": "hello",
};
const identifiers = {
  "agent.principal.current.id": "user_123",
  "agent.principal.initiator.id": "user_123",
  "gen_ai.memory.store.id": '["user","vercel-oidc",null,"user_123"]',
  "ai.settings.context.posthog_distinct_id": "user_123",
};

function exportThrough(
  name: keyof typeof destinations,
  attributes: Record<string, unknown>,
): ExportedSpan[] {
  recorded.destinations[name].length = 0;
  const span = {
    name: "chat openai/gpt-5",
    attributes,
    events: [],
    status: { code: 0 },
    spanContext: () => ({
      traceId: "t".repeat(32),
      spanId: "s".repeat(16),
    }),
  };
  for (const processor of destinations[name].spanProcessors) {
    if (typeof processor === "string") continue;
    processor.onStart(span as never, ROOT_CONTEXT);
    processor.onEnd(span as never);
  }
  return recorded.destinations[name];
}

describe("trace destinations", () => {
  // parseEnv returns the token and host under the POSTHOG_ names whichever
  // names the environment used, such as the ones PostHog's Vercel Marketplace
  // integration sets, so a processor that read process.env would miss them.
  it("PostHog takes its token and host from the validated environment", () => {
    expect(recorded.posthogOptions).toEqual([
      { projectToken: "test", host: "https://posthog.test" },
    ]);
  });

  it.each(audiences)(
    "Agent Runs keeps the span but drops content and user ids for %s conversations",
    (audience) => {
      const attributes = {
        "agent.channel.audience": audience,
        ...operational,
        ...content,
        ...identifiers,
      };

      expect(exportThrough("agentRuns", attributes)).toEqual([
        {
          name: "chat openai/gpt-5",
          attributes: { "agent.channel.audience": audience, ...operational },
        },
      ]);
    },
  );

  it.each(["posthog", "braintrust"] as const)(
    "%s still receives content and user ids",
    (name) => {
      const attributes = {
        "agent.channel.audience": "private",
        ...operational,
        ...content,
        ...identifiers,
      };

      expect(exportThrough(name, attributes)).toEqual([
        { name: "chat openai/gpt-5", attributes },
      ]);
    },
  );
});
