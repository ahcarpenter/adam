# Spec: Enterprise Boilerplate for the `adam` eve Agent

## Objective

Turn this freshly scaffolded eve app into an enterprise-grade boilerplate: full quality tooling (lint, format, test, coverage, dead-code, dependency automation), production observability (structured logging, distributed tracing, AI-trace evaluation), and Upstash-backed agent capabilities (memory, RAG, chat history, rate limiting, tool caching) — all as a **minimal skeleton**: real wiring, thin working stubs, no demo domain logic.

Success looks like: clone → `pnpm install` → set env vars → `eve dev` runs with logs flowing to PostHog, AI traces flowing to Braintrust, and CI green with coverage on Codecov.

## Assumptions

1. GitHub is the CI/CD host (remote is `github.com:ahcarpenter/adam`) → GitHub Actions for CI, Codecov via `codecov/codecov-action`, Renovate via the GitHub App with a repo config file.
2. PostHog Cloud (US) receives logs and agent traces (LLM analytics); project token available as an env var. No product-analytics event capture wiring.
3. Braintrust receives **only** AI spans (via the official `braintrustEveInstrumentation` integration); no non-AI spans, no logs. Projects are per environment (`adam` / `adam-preview` / `adam-dev`), with evals in `adam-evals`.
4. Deployment target is Vercel (`.vercel/` present); env vars managed with `vercel env`.
5. Package manager is pnpm (lockfile present); Node 24 per `engines`.
6. Unit tests are colocated (`*.test.ts` next to source); eve evals live in `evals/` (already aliased as `#evals/*`).
7. Drizzle is **out of scope** (removed by decision).
8. No OTLP **metrics** destination exists by default — neither PostHog nor Braintrust ingests them — so the metric pipeline is opt-in via `OTEL_EXPORTER_OTLP_ENDPOINT`.

→ Correct any of these before approving.

## Tech Stack

| Concern                     | Tool                                               | Notes                                                                                                                |
| --------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Framework                   | eve ^0.31.3, `ai` v7, TypeScript 7, Node 24, pnpm  | existing                                                                                                             |
| Lint + format (TS/JS/JSON)  | Biome                                              | linter **and** formatter for code                                                                                    |
| Format (everything else)    | Prettier                                           | Markdown, YAML, CSS only — scoped so the two never fight                                                             |
| Unit tests + coverage       | Vitest (`@vitest/coverage-v8`)                     | colocated `*.test.ts`                                                                                                |
| Coverage reporting          | Codecov                                            | uploaded from CI, `codecov.yml` thresholds                                                                           |
| Dead code / unused deps     | Knip                                               | runs in CI                                                                                                           |
| Dependency automation       | Renovate                                           | `renovate.json`, GitHub App                                                                                          |
| Schemas / validation        | Zod 4                                              | existing; also validates env vars at startup                                                                         |
| Structured logging          | winston                                            | JSON console transport + OTel bridge                                                                                 |
| Log pipeline                | OTel Logs SDK → OTLP/HTTP → PostHog                | endpoint `<POSTHOG_HOST>/i/v1/logs`, `Authorization: Bearer <token>`; trace/span ids auto-correlated in span context |
| Tracing                     | `@vercel/otel` via eve `agent/instrumentation.ts`  | `defineInstrumentation` + `registerOTel`                                                                             |
| AI trace destination        | `braintrustEveInstrumentation` from `braintrust`   | native turn/step/tool capture; plus `agent/hooks/braintrust.ts` (`braintrustEveHook`)                                |
| LLM analytics traces        | `PostHogSpanProcessor` from `@posthog/ai`          | span processor in `instrumentation.ts`; `posthog.distinct_id` user linking                                           |
| Metrics                     | OTel metrics API + OTLP push exporter              | RED on turns/tools/throttling; off unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set                                       |
| Failure logging             | `agent/hooks/observability.ts`                     | turn/step/session failures and tool-call results; logic in `agent/lib/observability.ts`                              |
| Memory + RAG + chat history | `@upstash/agentkit-eve-extension`                  | `agent/extensions/agentkit.ts` — `agentkit({ memory, search, chatHistory })`, single wiring point                    |
| Rate limiting               | `createRateLimitAuth` from `@upstash/agentkit-eve` | in channel auth pipeline, sliding window                                                                             |
| Tool caching                | `defineCachedTool` from `@upstash/agentkit-eve`    | documented pattern for future expensive tools; no shipped stub                                                       |
| Git hooks                   | husky (existing) + lint-staged                     | pre-commit: biome + prettier on staged files                                                                         |

## Commands

```
Dev:        pnpm dev                 # eve dev
Build:      pnpm build               # eve build
Typecheck:  pnpm typecheck           # tsc
Lint fix:   pnpm lint                # biome lint --write .
Lint:       pnpm lint:check          # biome lint .
Lint CI:    pnpm lint:ci             # biome ci . (lint + format, CI mode)
Format:     pnpm format              # biome check --write . && prettier --write "**/*.{md,yml,yaml,css}"
Fmt check:  pnpm format:check        # biome check . && prettier --check
Test:       pnpm test                # vitest run
Coverage:   pnpm test:coverage       # vitest run --coverage
Dead code:  pnpm knip                # knip
```

## Project Structure

```
agent/
  agent.ts                     # agent config (existing)
  instructions.md              # system prompt (existing)
  instrumentation.ts           # Braintrust base + PostHog trace exporter + logger bootstrap
  channels/
    eve.ts                     # eve channel with createRateLimitAuth ahead of authenticators
  extensions/
    agentkit.ts                # agentkit({ memory, search, chatHistory }) — single wiring point
  hooks/
    braintrust.ts              # braintrustEveHook (subagent/tool capture)
    observability.ts           # failure logging + RED metrics off the event stream
  lib/                         # shared authored code (eve's import-only slot)
    agent-name.ts              # the agent name, for workers that cannot resolve it
    diagnostics.ts             # OTel diag logger + neverThrow telemetry containment
    env.ts                     # zod-validated env vars
    environment.ts             # deployment environment + per-env Braintrust project
    logger.ts                  # winston config + self-configuring ensureLogger()
    metrics.ts                 # meter bootstrap + RED instruments
    observability.ts           # hook event handlers (testable half of the hook)
    observed-auth.ts           # rate-limit rejection logging/counting wrapper
    resource.ts                # service.name + deployment.environment.name
    shutdown.ts                # beforeExit drain for the log/metric providers
    step-attribution.ts        # posthog.distinct_id user attribution for steps
evals/                         # eve evals (existing alias)
specs/                         # this spec
.github/workflows/ci.yml      # lint, format check, typecheck, knip, test+coverage, codecov upload
biome.json
.prettierrc + .prettierignore  # scoped to md/yml/yaml/css
vitest.config.ts
knip.json
renovate.json
codecov.yml
.lintstagedrc.json + .husky/pre-commit (extend existing)
```

**Hard constraint (eve runtime):** **tool** files are snapshotted and resolve **package imports only** — they cannot import `agent/lib/` or other `agent/` modules. Channels, extensions, hooks, and `instrumentation.ts` are bundled normally and may import `agent/lib/` (verified: `pnpm build` with `agent/channels/eve.ts` importing three lib modules produces zero discovery diagnostics). Consequences:

- Per-tool config (e.g. `userId` resolvers) is repeated in each tool file, not shared.
- Logging everywhere goes through winston's default logger (`import winston from "winston"`). The eve runtime executes authored modules in separate workers, so no single startup call can configure them all — each process bootstraps once via the self-configuring `ensureLogger()` in `agent/lib/logger.ts`, and `ensureMetrics()` alongside it where metrics are recorded.

## Code Style

Biome defaults (recommended ruleset), 2-space indent, double quotes per Biome default. Example of the house style for a snapshotted (tool/channel/extension) file:

```ts
// agent/extensions/agentkit.ts
import agentkit from "@upstash/agentkit-eve-extension";
import { s } from "@upstash/redis";

export default agentkit({
  memory: { topK: 5, minScore: 1 },
  search: {
    schema: s.object({ title: s.string(), content: s.string() }),
    indexName: "documents",
  },
  chatHistory: true,
});
```

Conventions:

- Every external input validated with Zod; env access only through `agent/lib/env.ts`.
- Snapshotted files: default-export a single `define*`/factory call, config inline, no local abstractions.
- Logs: structured fields, never string interpolation of payloads (`logger.info("tool executed", { toolName, durationMs })`).

## Testing Strategy

- **Vitest** for unit tests, colocated `*.test.ts`. Coverage via v8 provider.
- Skeleton ships tests for every `agent/lib/` module: env parsing (including the closed `LOG_LEVEL` set), logger bootstrap (structured output, resource, level, drain registration), environment/project resolution, telemetry resource, diag installation, exit drain, metric bootstrap and instruments, the hook event handlers, and the rate-limit wrapper. Wiring files (`instrumentation.ts`, `channels/`, `extensions/`, `hooks/`) stay excluded from coverage, which is why each of them is a thin dispatcher over a tested `lib/` module.
- **eve evals** directory remains the home for model-behavior checks (out of scope to populate here beyond what scaffolding exists).
- Coverage uploaded to Codecov on every CI run; `codecov.yml` **fails the check when project coverage < 95%**. Wiring-only files that cannot meaningfully execute under unit tests (e.g. `agent/instrumentation.ts`) may be excluded from coverage — any exclusion is listed explicitly in `codecov.yml`/`vitest.config.ts` and justified in a comment.
- CI order: install → biome ci → prettier check → typecheck → knip → vitest coverage → codecov upload.

## Observability Design

Every signal answers one of five on-call questions, listed in `docs/observability.md`: are turns failing and why, how slow is a turn, are tool calls failing, are callers being throttled, what did one conversation do. Anything that answers none of them does not get added.

`agent/instrumentation.ts` wires traces; logs and metrics bootstrap per worker process:

1. `registerOTel` with `serviceName: agentName`.
2. **AI traces:** the official Braintrust eve integration (`braintrustEveInstrumentation` as the instrumentation base, plus `agent/hooks/braintrust.ts`) captures turns, steps, tool calls, and subagent interactions natively in Braintrust, into a per-environment project (`adam` / `adam-preview` / `adam-dev`; evals report to `adam-evals`).
3. **LLM analytics:** a `PostHogSpanProcessor` sends agent traces/generations to PostHog, linked to the authenticated user via `posthog.distinct_id` (`agent/lib/step-attribution.ts`, merged into the `step.started` handler). It batches; a `SimpleSpanProcessor` would POST once per span on the request path. `"auto"` sits alongside it in `spanProcessors` to keep `@vercel/otel`'s default export mechanism, which is the only path accepting non-AI spans; `traceChannelRequests: true` then gives request-level visibility there.
4. **Logs:** OTel `LoggerProvider` + `BatchLogRecordProcessor` + `OTLPLogExporter` pointed at `${POSTHOG_HOST}/i/v1/logs` with an `Authorization: Bearer ${POSTHOG_PROJECT_TOKEN}` header, bootstrapped per process by `ensureLogger()`, carrying an explicit resource (`service.name`, `deployment.environment.name`) and drained on `beforeExit`.
5. **winston:** JSON console transport plus `@opentelemetry/winston-transport` bridging into the OTel logs pipeline → PostHog. All logs — general and trace-correlated — land in PostHog; trace/span ids ride along automatically when logging inside an active span.
6. **Emitters:** `agent/hooks/observability.ts` logs turn/session failures at `error`, step failures and failed tool calls at `warn`, each line carrying `sessionId`, a stable `event` name, and the event's `details` payload. Handlers run inside `neverThrow` — eve escalates a thrown hook to `turn.failed`, and one on the failure cascade to `session.failed`.
7. **Metrics:** `ensureMetrics()` registers a meter provider only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set (no OTLP-metrics destination exists in this stack by default). Instruments: `agent.turns`, `agent.turn.duration`, `agent.tool_calls`, `agent.rate_limit.rejections`, all with closed attribute sets.
8. **Pipeline failures:** `diag` is wired to the console logger at `ERROR`, so a rejected export surfaces instead of being swallowed. Deliberately not winston — a log-export failure reported through winston would feed the exporter that just failed.

Env vars (all validated in `agent/lib/env.ts`):

```
OPENAI_API_KEY, OPENAI_MODEL
UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
BRAINTRUST_API_KEY
POSTHOG_HOST (default https://us.i.posthog.com), POSTHOG_PROJECT_TOKEN
LOG_LEVEL (default info; closed winston set)
OTEL_SERVICE_NAME (default adam)
OTEL_EXPORTER_OTLP_ENDPOINT (optional; metrics stay off without it)
```

## Boundaries

- **Always:** run `pnpm lint && pnpm typecheck && pnpm test` before committing; validate env through `agent/lib/env.ts`; keep Prettier and Biome file scopes disjoint; structured log fields only.
- **Ask first:** adding dependencies beyond this spec; changing channel auth; sending new data categories (inputs/outputs/PII) to PostHog or Braintrust; enabling `recordInputs/recordOutputs` changes; provisioning paid services.
- **Never:** commit secrets or `.env.local`; hand-edit `node_modules` or `.eve/`; delete or skip failing tests to pass CI; put shared imports inside `agent/tools|channels|extensions` files.

## Success Criteria

1. `pnpm build` (eve build) succeeds; the compiled manifest lists the agentkit extension's `agentkit__recall_memory`/`agentkit__save_memory` tools plus dynamic chat-history and search tools.
2. `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm knip`, `pnpm test:coverage` all pass locally and in CI.
3. CI workflow green on GitHub; coverage report visible on Codecov.
4. With env vars set, `eve dev` + one chat turn produces: (a) a trace in the `adam-dev` Braintrust project containing only AI spans, (b) chat transcript persisted in Upstash Redis. A healthy turn emits no log line by design — the trace describes it.
5. Rate limit verified: exceeding the sliding window returns 403 on the channel **and** emits one `event=rate_limit_rejected` log line.
6. Removed (refactor decision): no shipped cached tool; `defineCachedTool` documented as the pattern for future expensive tools.
7. Renovate opens its onboarding PR; lint-staged blocks a badly formatted commit.
8. A forced failure is diagnosable from telemetry alone: the `turn_failed`/`tool_call_failed` line in PostHog Logs carries `sessionId`, `code`, and structured fields, and locates the matching Braintrust trace.

## Open Questions

None.

## Decisions Log

- 2026-08-12 (implementation): winston-sharing risk resolved — the server build externalizes winston to a single import, so the default logger configured in `instrumentation.ts` is the same instance tool files get from `import winston from "winston"`. No `@opentelemetry/api-logs` fallback needed. **Amended below: does not hold across eve dev worker processes.**
- 2026-08-12 (amendment): the eve runtime executes hooks/tools/instrumentation in separate workers under `eve dev`, so a single startup configuration cannot reach every process (hooks logged "no transports"). Replaced with a self-configuring `ensureLogger()` in `agent/lib/logger.ts`: each logging module bootstraps its own process once (JSON console + OTel bridge to PostHog when env is complete; console-only otherwise). `instrumentation.ts` keeps production fail-fast and Braintrust trace registration. **Console-only fallback superseded below.**
- 2026-08-12 (amendment): added `agent/hooks/observability.ts` — structured lifecycle logging (session/turn started, completed, failed; tool results) — because the log pipeline previously had no emitters during normal operation. Note: `eve dev` TUI hides stdout by default; use `/loglevel all`, `Ctrl+L`, `eve dev --logs all`, or `eve logs` (`.eve/logs/` JSONL) to see log output locally. **Superseded below.**
- 2026-08-12 (user-directed): standardized on the official `instrumentation/braintrust` integration — `braintrustEveInstrumentation` wrapper as the instrumentation base (native `eve.turn`/`eve.step` capture via `initLogger`) plus `agent/hooks/braintrust.ts` (`braintrustEveHook`, `metadata.app: "adam"`). The OTel `BraintrustExporter` and `@braintrust/otel` dep are gone; `braintrust` is a direct dep. PostHog span processor + `distinct_id` event grafted into the wrapper's config (both official integrations claim `agent/instrumentation.ts`, so hand-merged); the merged `step.started` handler calls Braintrust's first and merges both `runtimeContext`s. Verified live: `eve.turn`/`eve.step` spans with `app: adam` in Braintrust; hook capture works from its own worker via the SDK's lazy env-based logger. Note: `eve info` needs env vars in the shell (`agent.ts` fails fast on missing `OPENAI_MODEL`; `.env.local` is loaded by `eve dev`, not `eve info`).
- 2026-08-12 (user-directed): adopted the PostHog trace exporter from eve's `instrumentation/posthog` integration, merged into the existing `agent/instrumentation.ts` (both official integrations claim the same file, so cherry-pick beats `eve add`). Agent traces/generations now land in PostHog LLM analytics with `posthog.distinct_id` user linking, alongside Braintrust (AI spans only, unchanged) — revises the earlier "AI traces to Braintrust only" call. The lifecycle hook and its tests were removed entirely (traces cover turn/tool lifecycle; failures alert from traces); PostHog Logs now carries only genuine app logs via the `ensureLogger()` pipeline, which stays.
- 2026-08-12 (implementation): instrumentation degrades gracefully outside production — incomplete env logs a structured warning and skips exporters instead of crashing `eve dev`; production (`NODE_ENV`/`VERCEL_ENV=production`) still fails fast. **Superseded below.**
- 2026-08-12 (implementation): rate limit over-limit responds **403 Forbidden** (ForbiddenError from `createRateLimitAuth`), not 429 as originally speculated. Success criterion 5 reads 403 accordingly.
- 2026-08-12 (implementation): extension also registers dynamic `agentkit__search*` tools even without `search` config; disabled via `disableTool()` overrides alongside the memory ones so authored `agent/tools/search.ts` is the only RAG surface. **Superseded by the refactor below.**
- 2026-08-12 (refactor, user-directed): standalone tool files replaced by the extension configuration reference (https://upstash.com/docs/redis/sdks/agentkit/eve#extension-configuration-reference). `agent/extensions/agentkit.ts` now configures memory (`topK: 5, minScore: 1`), search (`documents` index), and `chatHistory: true`; the directory mount, `disableTool()` overrides, standalone `agent/tools/*` files, and their smoke tests are gone. `cached_example` (tool-caching stub) removed with them — tool caching via `defineCachedTool` remains documented but unshipped. Rate limiting via `createRateLimitAuth` from `@upstash/agentkit-eve` stays in `agent/channels/eve.ts`. Success criteria 1 and 6 adjusted accordingly.
- 2026-08-12 (implementation): shared code lives in `agent/lib/` (eve's sanctioned import-only slot), not repo-root `lib/`. Env template is `env.example` (no leading dot) to stay outside `.env*` ignore/deny rules.

- 2026-08-12: Spec approved. Codecov gate set to fail below 95% project coverage (was: informational).
- 2026-08-12: Drizzle removed from scope. Biome owns TS/JS/JSON lint+format; Prettier scoped to md/yml/css. Standalone tool files own memory+RAG; extension scoped to chat history. Minimal skeleton scope.
- 2026-08-12: Ex-Open-Question 1 resolved. Transcript capture is extension-only (`hooks/chat_history.mjs`), so the extension stays. Its default memory tools are removed via eve directory mount: `agent/extensions/agentkit/extension.ts` + `disableTool()` overrides in `agent/extensions/agentkit/tools/{recall,save}_memory.ts` (eve docs "Override a contribution"). Extension `search` config omitted, so no search-tool conflict. Standalone `agent/tools/` files own memory+RAG per https://upstash.com/docs/redis/sdks/agentkit/eve#memory-and-rag-as-individual-tool-files.
- 2026-08-12 (user-directed): no degraded mode — an incomplete environment fails fast in every mode, local dev included. `parseEnv()` throws from `agent.ts` (full-environment validation at the earliest module, replacing the hand-rolled `OPENAI_MODEL` check), `ensureLogger()`, and the `instrumentation.ts` setup; the `NODE_ENV`/`VERCEL_ENV` production gate and both console-only fallbacks are removed.
- 2026-08-12 (docs): spec body swept to the current state after a ubiquitous-language audit — superseded design removed from the body (`BraintrustExporter`/`filterAISpans`, standalone tool files, repo-root `lib/`, `?token=` log endpoint, shipped cached-tool stub); this log remains the history.
- 2026-08-12 (observability audit): three wired paths were found carrying no data. (a) `traceChannelRequests: true` created SERVER spans that no backend accepted — `PostHogTraceExporter` forwards only `gen_ai.`/`llm.`/`ai.`/`traceloop.`-prefixed spans and Braintrust captures through its own SDK, so the spans cost latency, reached nothing, and left exported AI spans parented to a span absent from the backend. Root cause was `spanProcessors: [posthog]` replacing `@vercel/otel`'s default export mechanism; `"auto"` is now listed alongside it, restoring the only path that accepts non-AI spans (Vercel's tracing integration, or an OTLP exporter from `OTEL_EXPORTER_OTLP_*` — so the metrics endpoint doubles as a span destination). `traceChannelRequests` stays `true` on that basis. **Amendment:** briefly set to `false` when the user's first call was to leave `"auto"` out; reversed in the same pass when they opted back in. (b) `SimpleSpanProcessor` POSTed once per span on the request path, several times per turn; replaced with `PostHogSpanProcessor`, which batches and is what `@posthog/ai` recommends wherever a `SpanProcessor` is accepted. `@opentelemetry/sdk-trace-base` dropped as a direct dep. (c) The standalone `LoggerProvider` had no resource, so PostHog Logs received `service.name=unknown_service:node`, and nothing drained its batch queue. Both fixed via `agent/lib/resource.ts` and `agent/lib/shutdown.ts` (`beforeExit` only — a SIGTERM listener would suppress Node's default handling and race the runtime's own shutdown; a hard kill still loses up to one batch interval).
- 2026-08-12 (observability audit): `LOG_LEVEL` was read raw from `process.env`. winston resolves a level by map lookup and drops every record for one it cannot resolve, so `LOG_LEVEL=warning` was a silent total logging outage. Now a closed `z.enum` in `agent/lib/env.ts`, rejected at startup like every other variable. `OTEL_SERVICE_NAME` (default `adam`) and optional `OTEL_EXPORTER_OTLP_ENDPOINT` joined the schema.
- 2026-08-12 (observability audit): OTel `diag` was unset, so exporter and batch-processor failures — a bad token, the wrong region host, a 4xx from ingest — were swallowed entirely; the pipeline could be dead with no signal. `agent/lib/diagnostics.ts` installs the console diag logger at `ERROR`. Deliberately not winston: a log-export failure reported through winston would feed the exporter that just failed.
- 2026-08-12 (observability audit): reversing part of the 2026-08-12 PostHog-exporter decision, which removed the lifecycle hook on the grounds that "traces cover turn/tool lifecycle; failures alert from traces". That left the log pipeline with zero emitters — unexercised, unverifiable, and unable to satisfy the "structured logs in PostHog" criterion. `agent/hooks/observability.ts` returns, narrowed to failures and throughput: turn/session failures at `error`, step failures and failed tool calls at `warn`, no line at all for a healthy turn. Handlers live in `agent/lib/observability.ts` so they are covered by tests.
- 2026-08-12 (observability audit, user-directed): metrics added through the OTel metrics API with a `PeriodicExportingMetricReader`, active only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set — neither PostHog nor Braintrust ingests OTLP metrics, so this stack has no default destination and the instruments are no-ops until one is configured. Instruments: `agent.turns`, `agent.turn.duration` (seconds, buckets tuned for turns, not HTTP handlers), `agent.tool_calls`, `agent.rate_limit.rejections`. Attributes are closed sets only. Turn duration is measured from `meta.at` on the stream envelope rather than a local clock, held in a 1000-entry bounded map; a turn whose start was observed in another worker is still counted, just without a duration sample. Added deps: `@opentelemetry/sdk-metrics`, `@opentelemetry/exporter-metrics-otlp-http`, `@opentelemetry/resources`.
- 2026-08-12 (observability audit): rate-limit rejections were invisible in every backend — they happen in the auth walk before a session exists, so no AI span is produced and the request span is dropped per (a) above. `agent/lib/observed-auth.ts` wraps the limiter, counting and logging only `ForbiddenError` so a Redis outage is not miscounted as throttling. Note the identifier remains the raw `x-forwarded-for` header: spoofable, and a multi-hop chain keys separately. Out of scope for this pass, but it makes the throttling signal a floor rather than a true count.
- 2026-08-12 (observability audit, user-directed): telemetry split by environment. Braintrust projects are `adam` / `adam-preview` / `adam-dev`, resolved from `VERCEL_ENV` (`agent/lib/environment.ts`); evals report to `adam-evals`; logs and metrics carry `deployment.environment.name`. This reads the environment but does not branch behavior on it, so the 2026-08-12 "no degraded mode" decision holds — startup still fails fast identically everywhere. PostHog separation is left to per-environment project tokens.
- 2026-08-12 (observability audit, user-directed): `recordInputs`/`recordOutputs` stay on, now stated literally in `agent/instrumentation.ts` instead of inherited from the AI SDK default, with the data flow spelled out — both Braintrust and PostHog receive full message history and model output. Sampling likewise stays at 100%, with `OTEL_TRACES_SAMPLER` documented as the knob when volume makes that expensive.
- 2026-08-12 (observability audit): the "tool/channel/extension files are snapshotted, package imports only" constraint was too broad. Verified by build: `agent/channels/eve.ts` importing three `agent/lib/` modules produces a clean `pnpm build` with zero discovery diagnostics, and the new hook is discovered normally. The constraint is **tool files only**; the body has been corrected.
- 2026-08-12 (review, user-directed): failure `details` is logged after all. The initial pass withheld it as a possible carrier of model input; with `recordInputs`/`recordOutputs` already sending full message content to Braintrust and PostHog traces, withholding it from the log line bought no confidentiality and cost the first useful field an on-call engineer reaches for. Consequence recorded plainly: PostHog Logs is a content store, not a metadata store.
- 2026-08-12 (review): four defects found reviewing the audit changes. (1) **Critical** — every hook handler called winston unguarded while subscribed to failure-cascade events, so per eve's hook contract a throwing transport would surface as `turn.failed` and escalate to `session.failed`: instrumentation able to end the session it describes. All handlers now run inside `neverThrow` (`agent/lib/diagnostics.ts`), which reports through `diag` rather than winston, since winston is one of the things that can be failing. (2) `observeRateLimit` ran its metric and log before rethrowing, so a telemetry throw replaced the limiter's 403 with a 500; the same guard now wraps them and the original error always propagates. (3) `turn.cancelled` was unsubscribed, so cancelled turns never released their entry in the duration-tracking map — under cancellation load the 1000-entry cap would evict _live_ turn starts and silently thin the histogram. Cancellation is now a third `TurnOutcome`, which both releases the entry and keeps the turn rate honest. (4) `ensureMetrics` latched `started = true` before `parseEnv()`, permanently unmetering a process whose first call threw; the flag now follows a successful parse, matching `ensureLogger`'s retryable guard.
- 2026-08-12 (review follow-up): the four suggestions from the same review. Test isolation — `agent/lib/observability.test.ts` shared the handlers' module-level turn map, so the eviction case left a thousand entries behind and every later case depended on file order; each case now loads a fresh module, matching what `metrics.test.ts` already did for the same reason, and the suite passes under `vitest --sequence.shuffle`. Service name — `OTEL_SERVICE_NAME` defaults to `AGENT_NAME` from a single `agent/lib/agent-name.ts` rather than an inline literal, and `reportServiceNameDrift` warns from `instrumentation.ts`, the one place that sees both the configured value and the name eve resolved; a warning rather than a failure, because naming a worker separately is a legitimate override this cannot distinguish. Metric attributes — renamed to dotted, namespaced keys (`agent.turn.outcome`, `agent.channel.kind`, `agent.tool.name`, `agent.tool.status`), consistent with the instrument names and deliberately not under `eve.`, which the runtime reserves for its own attributes.
- 2026-08-12 (review follow-up): `evals/evals.config.ts` keeps `"adam-evals"` as a literal instead of composing it from `AGENT_NAME`. `eve eval --list` does not load the config file — it still succeeds with a deliberately broken import — so whether the eval runner resolves an import across the `evals/` → `agent/` boundary cannot be established without a live eval run against the model. A duplicated word is the better trade against a config that fails to load; a comment in the file names the coupling.
