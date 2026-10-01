# Observability design

How logs, metrics, and traces are wired, what each signal is for, and how to tell
whether the pipeline is actually working. See [configuration](configuration.md) for the
environment variables referenced here.

## Questions on-call has to answer

Every signal below exists to answer one of these. A signal that answers none
of them should not be added.

1. **Are turns failing, and why?** — `agent.turns{agent.turn.outcome}` for the
   rate (`completed` / `failed` / `cancelled`), the `turn_failed` log line for
   the `code`, message, and `details` behind it.
2. **How slow is a turn?** — `agent.turn.duration`, read at p95/p99. Never
   as an average.
3. **Are tool calls failing?** — `agent.tool_calls`, keyed by
   `agent.tool.name` and `agent.tool.status`, plus the `tool_call_failed`
   log line.
4. **Are callers being throttled?** — `agent.rate_limit.rejections` and the
   `rate_limit_rejected` log. This happens in the auth walk before a session
   exists, so no trace records it.
5. **What did this specific conversation do?** — the Braintrust trace, or
   PostHog LLM analytics filtered by `posthog.distinct_id`.

## Signals

`agent/instrumentation/` is the wiring point for traces, one file per
destination plus `otel.ts` for the settings they share;
`agent/lib/logger.ts` and `agent/lib/metrics.ts` bootstrap the other two per
worker process (the eve runtime runs authored modules in separate workers,
so no single startup call reaches them all).

- **Logs** — `ensureLogger()` gives each process JSON console output plus an
  OTel bridge to PostHog Logs, stamped with `service.name` and
  `deployment.environment.name`. Any authored file logs through
  `import winston from "winston"`; records emitted inside a span carry
  trace/span ids, and every line from `agent/lib/observability.ts` carries
  `sessionId` and a stable `event` name. Failure lines include the event's
  `details` payload, which is shaped by whatever failed and can carry model
  input — PostHog Logs is therefore a content store, on the same footing as
  the traces the trace policy already sends. Every handler runs inside
  `neverThrow`. Since eve 0.68 a thrown hook no longer fails the turn or the
  session: eve logs it, runs the remaining subscribers and continues. The
  wrapper is therefore a precaution, so instrumentation cannot end the
  session it is describing whatever the runtime does with a throw.
- **Metrics** — `ensureMetrics()` registers a meter provider only when
  `OTEL_EXPORTER_OTLP_ENDPOINT` is set. Neither PostHog nor Braintrust
  ingests OTLP metrics, so there is no default destination and the
  instruments are no-ops until you point them at a collector. Attribute keys
  are dotted and namespaced under `agent.` (not `eve.`, which the runtime
  reserves), and every one is a closed set — outcome, channel kind, tool
  name; ids and addresses stay in logs and traces where cardinality is free.
- **Traces** — eve emits one GenAI span tree per turn (`invoke_agent`,
  `agent.step`, `chat`, `execute_tool`). `braintrust.ts` sends its AI spans
  to Braintrust through `@braintrust/otel`'s `BraintrustSpanProcessor`
  (Braintrust's own eve integration still declares a `capture` field eve no
  longer accepts); `posthog.ts` sends them to PostHog LLM analytics, linked to
  the authenticated user through the `posthog_distinct_id` runtime context.
  The trace policy in `otel.ts` states `recordInputs`/`recordOutputs`
  explicitly and turns both on for every environment and audience, where
  eve's default would keep content only in development and for public
  conversations. eve also caps content to metadata for private and unknown
  conversations outside development whatever the policy says, so
  `agent/channels/eve.ts` sets `audience: "public"` (trace capture only; `auth`
  still controls access). Together, Braintrust, PostHog, and the OTLP
  collector (when `OTEL_EXPORTER_OTLP_ENDPOINT` is set) receive full message
  history and model output: all three are content stores, and PostHog and
  Braintrust also get the user's principal id. Vercel Agent Runs is not:
  `agent-runs.ts` redacts inputs and outputs from every span eve sends it
  and drops principal ids, the principal-scoped memory store id, and
  app-authored runtime context (the PostHog distinct id), so it receives
  operational metadata without message content or user identifiers (model,
  token counts, timing, span names, status, and eve's opaque run and
  session ids, which Agent Runs groups traces by). Tests pin the policy,
  what each destination receives, and the audience. Turn both off, and drop the audience,
  before pointing this at regulated traffic.
- **Request spans** — `traceChannelRequests: true` wraps each inbound channel
  request in a low-cardinality SERVER span (route template and method, never
  the concrete URL) that the turn trace links to. PostHog and Braintrust keep
  only AI spans, so these reach Agent Runs on Vercel (preview and
  production), and `otlp.ts` sends every span to the
  collector `OTEL_EXPORTER_OTLP_ENDPOINT` names when it is set.

One deliberate omission: sampling is 100%, which suits this volume — set
`OTEL_TRACES_SAMPLER` (honored by eve's trace pipeline) when traffic makes that
expensive.

Telemetry is split by environment so an incident dashboard never shows local
or preview traffic: Braintrust projects are `adam` / `adam-preview` /
`adam-dev` (from `VERCEL_ENV`), evals report to `adam-evals`, and every log
and metric carries `deployment.environment.name`. PostHog separation is by
project token — use a different one per Vercel environment.

## Alerts

None are defined in code; PostHog and Braintrust own them. Create these
three, and nothing that pages on a cause (CPU, memory, a pod restart):

| Alert            | Condition                                                         | Severity | First move                                                                                    |
| ---------------- | ----------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------- |
| Turns failing    | `agent.turns{agent.turn.outcome=failed}` > 1% over 5 min          | page     | Group `turn_failed` logs by `code`; open one failing session's Braintrust trace.              |
| Turns slow       | `agent.turn.duration` p99 > 60s over 10 min                       | page     | Compare model-call span duration against tool spans in a slow trace.                          |
| Tool degradation | `agent.tool_calls{agent.tool.status!=completed}` > 5% over 15 min | ticket   | Group `tool_call_failed` by `tool` and `code`; check Upstash Redis health for AgentKit tools. |

Thresholds are starting points — replace them with numbers from your own
traffic once there is a week of it.

## Verifying the pipeline

Instrumentation is code and can be wrong, and only the log path is exercised
by ordinary traffic on failure. After changing any of it:

1. Force a tool failure in dev, then find `event=tool_call_failed` in
   PostHog Logs by `sessionId`, with fields structured (not
   `[object Object]`).
2. Confirm the same turn appears in Braintrust under the `-dev` project.
3. Exceed the rate limit (21 POSTs inside a minute) and confirm one
   `rate_limit_rejected` line per rejection.
4. With `OTEL_EXPORTER_OTLP_ENDPOINT` set, confirm `agent.turns` and
   `agent.turn.duration` arrive with the expected attributes.

An export that fails (bad token, wrong region host) surfaces on stderr via
the OTel diagnostic logger rather than disappearing — check there first when
a signal is missing. A `service_name_drift` warning at startup means logs and
metrics are landing under a different service than traces, which happens if
the package is renamed without updating `OTEL_SERVICE_NAME`.
