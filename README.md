# adam — enterprise eve agent boilerplate

An [eve](https://eve.dev) agent with enterprise tooling, observability, and
Upstash-backed capabilities wired in as a minimal skeleton. Spec, plan, and
task history live in [`specs/`](specs/enterprise-boilerplate.md).

## Stack

| Concern                                               | Tool                                           |
| ----------------------------------------------------- | ---------------------------------------------- |
| Lint + format (TS/JS/JSON)                            | Biome                                          |
| Format (md/yml/css)                                   | Prettier                                       |
| Tests + coverage                                      | Vitest (v8), 95% thresholds                    |
| Coverage gate                                         | Codecov (95% project/patch)                    |
| Dead code / unused deps                               | Knip                                           |
| Dependency automation                                 | Renovate                                       |
| Structured logging                                    | winston → OTel logs → PostHog                  |
| Tracing                                               | `@vercel/otel`; AI spans → Braintrust, PostHog |
| Metrics                                               | OTel metrics API → OTLP (opt-in, see below)    |
| Memory / RAG / chat history / rate limit / tool cache | Upstash Redis (AgentKit)                       |

## Commands

```
pnpm dev            # eve dev (TUI at http://127.0.0.1:2000)
pnpm build          # eve build
pnpm typecheck      # tsc
pnpm lint           # biome lint --write . (auto-fix)
pnpm lint:check     # biome lint . (no writes)
pnpm lint:ci        # biome ci . (lint + format, CI mode)
pnpm format         # biome check --write + prettier --write (md/yml/css)
pnpm format:check   # biome check + prettier --check
pnpm test           # vitest run
pnpm test:coverage  # vitest run --coverage (95% thresholds)
pnpm knip           # dead code / unused dependency scan
```

## Environment

Copy `env.example` to `.env.local` and fill in:

| Variable                                              | Purpose                                                         |
| ----------------------------------------------------- | --------------------------------------------------------------- |
| `OPENAI_API_KEY` / `OPENAI_MODEL`                     | Agent model (`@ai-sdk/openai` in `agent/agent.ts`)              |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Memory, RAG, chat history, rate limiting, tool cache            |
| `BRAINTRUST_API_KEY`                                  | AI trace export                                                 |
| `POSTHOG_HOST`                                        | PostHog region host (defaults to `https://us.i.posthog.com`)    |
| `POSTHOG_PROJECT_TOKEN`                               | Log export                                                      |
| `LOG_LEVEL`                                           | winston level, closed set (defaults to `info`)                  |
| `OTEL_SERVICE_NAME`                                   | `service.name` on logs and metrics (defaults to the agent name) |
| `OTEL_EXPORTER_OTLP_ENDPOINT`                         | OTLP collector: metrics, and all spans via `"auto"`             |

Startup fails fast on an invalid environment in every mode, local dev
included. `POSTHOG_HOST`, `LOG_LEVEL`, and `OTEL_SERVICE_NAME` default;
`OTEL_EXPORTER_OTLP_ENDPOINT` is genuinely optional. `LOG_LEVEL` is a closed
enum on purpose: winston resolves a level by map lookup and drops _every_
record for one it does not recognize, so `LOG_LEVEL=warning` would be a
silent logging outage rather than an error.

## Observability design

### Questions on-call has to answer

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

### Signals

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

### Alerts

None are defined in code; PostHog and Braintrust own them. Create these
three, and nothing that pages on a cause (CPU, memory, a pod restart):

| Alert            | Condition                                                         | Severity | First move                                                                                    |
| ---------------- | ----------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------- |
| Turns failing    | `agent.turns{agent.turn.outcome=failed}` > 1% over 5 min          | page     | Group `turn_failed` logs by `code`; open one failing session's Braintrust trace.              |
| Turns slow       | `agent.turn.duration` p99 > 60s over 10 min                       | page     | Compare model-call span duration against tool spans in a slow trace.                          |
| Tool degradation | `agent.tool_calls{agent.tool.status!=completed}` > 5% over 15 min | ticket   | Group `tool_call_failed` by `tool` and `code`; check Upstash Redis health for AgentKit tools. |

Thresholds are starting points — replace them with numbers from your own
traffic once there is a week of it.

### Verifying the pipeline

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

## Upstash capabilities

- `agent/extensions/agentkit.ts` — single wiring point for long-term
  **memory** (`agentkit__recall_memory`/`agentkit__save_memory`), **RAG** over
  a Redis Search index (`documents` placeholder — replace the schema with
  your domain documents; the index is created reactively on first use), and
  durable **chat history**. See the
  [extension configuration reference](https://upstash.com/docs/redis/sdks/agentkit/eve#extension-configuration-reference).
- `agent/channels/eve.ts` — sliding-window rate limit (20 req/min per caller,
  403 over the limit) via `createRateLimitAuth` from `@upstash/agentkit-eve`,
  ahead of the real authenticators.
- For expensive tools, memoize with `defineCachedTool` from
  `@upstash/agentkit-eve` (`agentkit:toolCache:*` keys).

Eve snapshots tool files and resolves only package imports, so any future
`agent/tools/*.ts` file must be self-contained — repeat config rather than
importing shared `agent/` modules. Shared _authored_ helpers belong in
`agent/lib/` (import-only slot).

## One-time setup (repo owner)

1. **Codecov**: add the `CODECOV_TOKEN` repository secret — activates the 95%
   coverage gate in CI.
2. **Renovate**: install the Renovate GitHub App on this repo — it picks up
   `renovate.json` and opens an onboarding PR.
3. **Upstash / Braintrust / PostHog**: provision and set the env vars above
   (locally in `.env.local`, on Vercel via `vercel env`).
