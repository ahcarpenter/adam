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

`agent/instrumentation.ts` is the wiring point for traces;
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
  the traces `recordInputs` already sends. Every handler runs inside
  `neverThrow`: eve escalates a thrown hook to `turn.failed`, and one on the
  failure cascade to `session.failed`, so instrumentation must never be able
  to end the session it is describing.
- **Metrics** — `ensureMetrics()` registers a meter provider only when
  `OTEL_EXPORTER_OTLP_ENDPOINT` is set. Neither PostHog nor Braintrust
  ingests OTLP metrics, so there is no default destination and the
  instruments are no-ops until you point them at a collector. Attribute keys
  are dotted and namespaced under `agent.` (not `eve.`, which the runtime
  reserves), and every one is a closed set — outcome, channel kind, tool
  name; ids and addresses stay in logs and traces where cardinality is free.
- **Traces** — the official Braintrust eve integration
  (`braintrustEveInstrumentation` + `agent/hooks/braintrust.ts`) captures
  turns, steps, tool calls, and subagent interactions natively in Braintrust;
  a `PostHogSpanProcessor` sends agent traces/generations to PostHog LLM
  analytics, linked to the authenticated user via `posthog.distinct_id`.
  `recordInputs`/`recordOutputs` are stated explicitly in
  `agent/instrumentation.ts` and are on: both vendors receive full message
  history and model output. Turn them off before pointing this at regulated
  traffic.
- **Request spans** — `traceChannelRequests: true` wraps each inbound channel
  request in a low-cardinality SERVER span (route template and method, never
  the concrete URL) that parents the turn trace. PostHog's exporter drops
  non-AI spans, so these ride the `"auto"` span processor instead: Vercel's
  tracing integration when the project has one, otherwise an OTLP exporter
  built from `OTEL_EXPORTER_OTLP_*`. Naming any processor replaces that
  default, which is why `"auto"` is listed alongside PostHog's.

One deliberate omission: sampling is 100%, which suits this volume — set
`OTEL_TRACES_SAMPLER` (honored by `@vercel/otel`) when traffic makes that
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
