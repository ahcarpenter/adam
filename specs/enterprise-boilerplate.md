# Spec: Enterprise Boilerplate for the `adam` eve Agent

## Objective

Turn this freshly scaffolded eve app into an enterprise-grade boilerplate: full quality tooling (lint, format, test, coverage, dead-code, dependency automation), production observability (structured logging, distributed tracing, AI-trace evaluation), and Upstash-backed agent capabilities (memory, RAG, chat history, rate limiting, tool caching) — all as a **minimal skeleton**: real wiring, thin working stubs, no demo domain logic.

Success looks like: clone → `pnpm install` → set env vars → `eve dev` runs with logs flowing to PostHog, AI traces flowing to Braintrust, and CI green with coverage on Codecov.

## Assumptions

1. GitHub is the CI/CD host (remote is `github.com:ahcarpenter/adam`) → GitHub Actions for CI, Codecov via `codecov/codecov-action`, Renovate via the GitHub App with a repo config file.
2. PostHog Cloud (US) is the log destination; project token available as an env var. PostHog is used **only** as a log sink in this boilerplate — no product-analytics event capture wiring.
3. Braintrust receives **only** AI spans (`filterAISpans: true`); no non-AI spans, no logs.
4. Deployment target is Vercel (`.vercel/` present); env vars managed with `vercel env`.
5. Package manager is pnpm (lockfile present); Node 24 per `engines`.
6. Unit tests are colocated (`*.test.ts` next to source); eve evals live in `evals/` (already aliased as `#evals/*`).
7. Drizzle is **out of scope** (removed by decision).

→ Correct any of these before approving.

## Tech Stack

| Concern                    | Tool                                                             | Notes                                                                                                              |
| -------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Framework                  | eve ^0.31.3, `ai` v7, TypeScript 7, Node 24, pnpm                | existing                                                                                                           |
| Lint + format (TS/JS/JSON) | Biome                                                            | linter **and** formatter for code                                                                                  |
| Format (everything else)   | Prettier                                                         | Markdown, YAML, CSS only — scoped so the two never fight                                                           |
| Unit tests + coverage      | Vitest (`@vitest/coverage-v8`)                                   | colocated `*.test.ts`                                                                                              |
| Coverage reporting         | Codecov                                                          | uploaded from CI, `codecov.yml` thresholds                                                                         |
| Dead code / unused deps    | Knip                                                             | runs in CI                                                                                                         |
| Dependency automation      | Renovate                                                         | `renovate.json`, GitHub App                                                                                        |
| Schemas / validation       | Zod 4                                                            | existing; also validates env vars at startup                                                                       |
| Structured logging         | winston                                                          | JSON console transport + OTel bridge                                                                               |
| Log pipeline               | OTel Logs SDK → OTLP/HTTP → PostHog                              | endpoint `<POSTHOG_HOST>/i/v1/logs?token=<token>`; trace/span ids auto-correlated when emitted inside span context |
| Tracing                    | `@vercel/otel` via eve `agent/instrumentation.ts`                | `defineInstrumentation` + `registerOTel`                                                                           |
| AI trace destination       | `@braintrust/otel` `BraintrustExporter`                          | `parent: project_name:adam`, `filterAISpans: true`                                                                 |
| Memory + RAG tools         | `@upstash/agentkit-eve`                                          | standalone tool files (see structure)                                                                              |
| Chat history               | `extension/upstash-agentkit` (`@upstash/agentkit-eve-extension`) | `chatHistory: true`; memory tools disabled in extension (owned by standalone files)                                |
| Rate limiting              | `createRateLimitAuth` from `@upstash/agentkit-eve`               | in channel auth pipeline, sliding window                                                                           |
| Tool caching               | `defineCachedTool` from `@upstash/agentkit-eve`                  | one thin stub tool demonstrating the pattern                                                                       |
| Git hooks                  | husky (existing) + lint-staged                                   | pre-commit: biome + prettier on staged files                                                                       |

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
  instrumentation.ts           # OTel: Braintrust traces + PostHog logs + winston setup
  channels/                    # channel(s) with createRateLimitAuth in auth pipeline
  extensions/
    agentkit.ts                # agentkit({ memory, search, chatHistory }) — single wiring point
lib/
  env.ts                       # zod-validated env vars
  logger.ts                    # winston config helper (used from instrumentation.ts)
evals/                         # eve evals (existing alias)
specs/                         # this spec
.github/workflows/ci.yml      # lint, format check, typecheck, knip, test+coverage, codecov upload
biome.json
.prettierrc + .prettierignore  # scoped to md/yml/yaml/css
vitest.config.ts
knip.json
renovate.json
codecov.yml
.lintstagedrc + .husky/pre-commit (extend existing)
```

**Hard constraint (eve runtime):** tool/channel/extension files are snapshotted and resolve **package imports only** — they cannot import `lib/` or other `agent/` modules. Consequences:

- Per-tool config (e.g. `userId` resolvers) is repeated in each tool file, not shared.
- Logging from tool files uses winston's default logger (`import winston from "winston"`), configured once at startup in `instrumentation.ts` — same module instance at runtime. Verified during implementation; fallback is `@opentelemetry/api-logs` directly.

## Code Style

Biome defaults (recommended ruleset), 2-space indent, double quotes per Biome default. Example of the house style for a tool file:

```ts
// agent/tools/recall_memory.ts
import { defineMemoryRecallTool } from "@upstash/agentkit-eve";

export default defineMemoryRecallTool({
  userId: (_, ctx) => ctx.session.auth.current?.principalId ?? ctx.session.id,
  topK: 5,
  minScore: 1,
});
```

Conventions:

- Every external input validated with Zod; env access only through `lib/env.ts`.
- Tool files: default-export a single `define*` call, config inline, no local abstractions.
- Logs: structured fields, never string interpolation of payloads (`logger.info("tool executed", { toolName, durationMs })`).

## Testing Strategy

- **Vitest** for unit tests, colocated `*.test.ts`. Coverage via v8 provider.
- Skeleton ships tests for: `lib/env.ts` (valid/invalid env), `lib/logger.ts` (shape of structured output), and one tool-config smoke test.
- **eve evals** directory remains the home for model-behavior checks (out of scope to populate here beyond what scaffolding exists).
- Coverage uploaded to Codecov on every CI run; `codecov.yml` **fails the check when project coverage < 95%**. Wiring-only files that cannot meaningfully execute under unit tests (e.g. `agent/instrumentation.ts`) may be excluded from coverage — any exclusion is listed explicitly in `codecov.yml`/`vitest.config.ts` and justified in a comment.
- CI order: install → biome ci → prettier check → typecheck → knip → vitest coverage → codecov upload.

## Observability Design

One `agent/instrumentation.ts` configures everything:

1. `registerOTel` with `serviceName: agentName`.
2. **Traces:** `BraintrustExporter({ parent, filterAISpans: true })` — AI spans only reach Braintrust.
3. **Logs:** OTel `LoggerProvider` + `BatchLogRecordProcessor` + `OTLPLogExporter` pointed at `${POSTHOG_HOST}/i/v1/logs?token=${POSTHOG_PROJECT_TOKEN}`.
4. **winston:** configured at startup with (a) JSON console transport, (b) `@opentelemetry/winston-transport` bridging into the OTel logs pipeline → PostHog. All logs — general and trace-correlated — land in PostHog; trace/span ids ride along automatically when logging inside an active span.

Env vars (all validated in `lib/env.ts`):

```
UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
BRAINTRUST_API_KEY
POSTHOG_HOST (default https://us.i.posthog.com), POSTHOG_PROJECT_TOKEN
```

## Boundaries

- **Always:** run `pnpm lint && pnpm typecheck && pnpm test` before committing; validate env through `lib/env.ts`; keep Prettier and Biome file scopes disjoint; structured log fields only.
- **Ask first:** adding dependencies beyond this spec; changing channel auth; sending new data categories (inputs/outputs/PII) to PostHog or Braintrust; enabling `recordInputs/recordOutputs` changes; provisioning paid services.
- **Never:** commit secrets or `.env.local`; hand-edit `node_modules` or `.eve/`; delete or skip failing tests to pass CI; put shared imports inside `agent/tools|channels|extensions` files.

## Success Criteria

1. `pnpm build` (eve build) succeeds; the compiled manifest lists the agentkit extension's `agentkit__recall_memory`/`agentkit__save_memory` tools plus dynamic chat-history and search tools.
2. `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm knip`, `pnpm test:coverage` all pass locally and in CI.
3. CI workflow green on GitHub; coverage report visible on Codecov.
4. With env vars set, `eve dev` + one chat turn produces: (a) a trace in Braintrust containing only AI spans, (b) structured logs in PostHog carrying trace ids, (c) chat transcript persisted in Upstash Redis.
5. Rate limit verified: exceeding the sliding window returns 403 on the channel.
6. Removed (refactor decision): no shipped cached tool; `defineCachedTool` documented as the pattern for future expensive tools.
7. Renovate opens its onboarding PR; lint-staged blocks a badly formatted commit.

## Open Questions

None.

## Decisions Log

- 2026-08-12 (implementation): winston-sharing risk resolved — the server build externalizes winston to a single import, so the default logger configured in `instrumentation.ts` is the same instance tool files get from `import winston from "winston"`. No `@opentelemetry/api-logs` fallback needed. **Amended below: does not hold across eve dev worker processes.**
- 2026-08-12 (amendment): the eve runtime executes hooks/tools/instrumentation in separate workers under `eve dev`, so a single startup configuration cannot reach every process (hooks logged "no transports"). Replaced with a self-configuring `ensureLogger()` in `agent/lib/logger.ts`: each logging module bootstraps its own process once (JSON console + OTel bridge to PostHog when env is complete; console-only otherwise). `instrumentation.ts` keeps production fail-fast and Braintrust trace registration.
- 2026-08-12 (amendment): added `agent/hooks/observability.ts` — structured lifecycle logging (session/turn started, completed, failed; tool results) — because the log pipeline previously had no emitters during normal operation. Note: `eve dev` TUI hides stdout by default; use `/loglevel all`, `Ctrl+L`, `eve dev --logs all`, or `eve logs` (`.eve/logs/` JSONL) to see log output locally. **Superseded below.**
- 2026-08-12 (user-directed): standardized on the official `instrumentation/braintrust` integration — `braintrustEveInstrumentation` wrapper as the instrumentation base (native `eve.turn`/`eve.step` capture via `initLogger`) plus `agent/hooks/braintrust.ts` (`braintrustEveHook`, `metadata.app: "adam"`). The OTel `BraintrustExporter` and `@braintrust/otel` dep are gone; `braintrust` is a direct dep. PostHog span processor + `distinct_id` event grafted into the wrapper's config (both official integrations claim `agent/instrumentation.ts`, so hand-merged); the merged `step.started` handler calls Braintrust's first and merges both `runtimeContext`s. Verified live: `eve.turn`/`eve.step` spans with `app: adam` in Braintrust; hook capture works from its own worker via the SDK's lazy env-based logger. Note: `eve info` needs env vars in the shell (`agent.ts` fails fast on missing `OPENAI_MODEL`; `.env.local` is loaded by `eve dev`, not `eve info`).
- 2026-08-12 (user-directed): adopted the PostHog trace exporter from eve's `instrumentation/posthog` integration, merged into the existing `agent/instrumentation.ts` (both official integrations claim the same file, so cherry-pick beats `eve add`). Agent traces/generations now land in PostHog LLM analytics with `posthog.distinct_id` user linking, alongside Braintrust (AI spans only, unchanged) — revises the earlier "AI traces to Braintrust only" call. The lifecycle hook and its tests were removed entirely (traces cover turn/tool lifecycle; failures alert from traces); PostHog Logs now carries only genuine app logs via the `ensureLogger()` pipeline, which stays.
- 2026-08-12 (implementation): instrumentation degrades gracefully outside production — incomplete env logs a structured warning and skips exporters instead of crashing `eve dev`; production (`NODE_ENV`/`VERCEL_ENV=production`) still fails fast.
- 2026-08-12 (implementation): rate limit over-limit responds **403 Forbidden** (ForbiddenError from `createRateLimitAuth`), not 429 as originally speculated. Success criterion 5 reads 403 accordingly.
- 2026-08-12 (implementation): extension also registers dynamic `agentkit__search*` tools even without `search` config; disabled via `disableTool()` overrides alongside the memory ones so authored `agent/tools/search.ts` is the only RAG surface. **Superseded by the refactor below.**
- 2026-08-12 (refactor, user-directed): standalone tool files replaced by the extension configuration reference (https://upstash.com/docs/redis/sdks/agentkit/eve#extension-configuration-reference). `agent/extensions/agentkit.ts` now configures memory (`topK: 5, minScore: 1`), search (`documents` index), and `chatHistory: true`; the directory mount, `disableTool()` overrides, standalone `agent/tools/*` files, and their smoke tests are gone. `cached_example` (tool-caching stub) removed with them — tool caching via `defineCachedTool` remains documented but unshipped. Rate limiting via `createRateLimitAuth` from `@upstash/agentkit-eve` stays in `agent/channels/eve.ts`. Success criteria 1 and 6 adjusted accordingly.
- 2026-08-12 (implementation): shared code lives in `agent/lib/` (eve's sanctioned import-only slot), not repo-root `lib/`. Env template is `env.example` (no leading dot) to stay outside `.env*` ignore/deny rules.

- 2026-08-12: Spec approved. Codecov gate set to fail below 95% project coverage (was: informational).
- 2026-08-12: Drizzle removed from scope. Biome owns TS/JS/JSON lint+format; Prettier scoped to md/yml/css. Standalone tool files own memory+RAG; extension scoped to chat history. Minimal skeleton scope.
- 2026-08-12: Ex-Open-Question 1 resolved. Transcript capture is extension-only (`hooks/chat_history.mjs`), so the extension stays. Its default memory tools are removed via eve directory mount: `agent/extensions/agentkit/extension.ts` + `disableTool()` overrides in `agent/extensions/agentkit/tools/{recall,save}_memory.ts` (eve docs "Override a contribution"). Extension `search` config omitted, so no search-tool conflict. Standalone `agent/tools/` files own memory+RAG per https://upstash.com/docs/redis/sdks/agentkit/eve#memory-and-rag-as-individual-tool-files.
