# Plan: Enterprise Boilerplate Implementation

Implements `specs/enterprise-boilerplate.md`. Five phases, each ending in a verification checkpoint. A → B are sequential; C and D can proceed in parallel after B; E is last.

## Phase A — Tooling foundation

No runtime coupling; tasks independent.

- **A1 Biome**: add `@biomejs/biome`; `biome.json` — linter (recommended rules) + formatter for TS/JS/JSON. Ignore: `node_modules`, `.eve`, `.output`, `.vercel`, `pnpm-lock.yaml`, md/yml/css.
- **A2 Prettier**: add `prettier`; `.prettierrc`; `.prettierignore` scoping it to `**/*.{md,yml,yaml,css}` only.
- **A3 Vitest**: add `vitest`, `@vitest/coverage-v8`; `vitest.config.ts` — coverage on `lib/**` and `agent/**`, local thresholds mirroring the 95% gate, exclusions (wiring-only files) listed with justification comments.
- **A4 Knip**: add `knip`; `knip.json` tuned for eve conventions (default-exported tool/channel/extension files are entries, not dead code).
- **A5 Renovate**: `renovate.json` — `config:recommended`, lockfile maintenance, group OTel packages.
- **A6 Codecov**: `codecov.yml` — project status fails < 95%; ignore list mirrors vitest exclusions.
- **A7 Hooks**: `lint-staged` + existing husky — pre-commit runs biome on staged code files, prettier on staged md/yml/css.
- **A8 Scripts**: wire all `pnpm` scripts from spec Commands section.

**Checkpoint A**: `pnpm lint`, `format:check`, `typecheck`, `knip`, `test` (no tests yet = pass), `pnpm build` all green.

## Phase B — Env + logging lib (before C)

- **B1 `lib/env.ts`**: zod schema for `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `BRAINTRUST_API_KEY`, `POSTHOG_HOST` (default `https://us.i.posthog.com`), `POSTHOG_PROJECT_TOKEN`. Parse function + unit tests (valid, missing, malformed).
- **B2 `lib/logger.ts`**: winston setup helper — JSON console transport + pluggable OTel transport; configures winston's default logger. Tests assert structured output shape.
- **B3 `.env.example`**: all env vars documented.

**Checkpoint B**: vitest green; coverage ≥ 95% on `lib/`.

## Phase C — Observability wiring (after B; parallel with D)

- **C1 Deps**: `winston`, `@vercel/otel`, `@braintrust/otel`, `@opentelemetry/sdk-logs`, `@opentelemetry/exporter-logs-otlp-http`, `@opentelemetry/winston-transport`, `@opentelemetry/api-logs`.
- **C2 `agent/instrumentation.ts`**: `defineInstrumentation({ setup })` → `registerOTel({ serviceName: agentName, traceExporter: new BraintrustExporter({ parent, filterAISpans: true }) })`; OTel `LoggerProvider` + `BatchLogRecordProcessor` + `OTLPLogExporter` → `${POSTHOG_HOST}/i/v1/logs?token=${POSTHOG_PROJECT_TOKEN}`; winston configured via `lib/logger.ts`.
- **C3 Verify winston sharing**: log from a tool file via `import winston from "winston"` under `eve dev`; confirm the startup-configured default logger instance is shared. If not: switch tool-file logging to `@opentelemetry/api-logs` and record the decision in the spec.

**Checkpoint C**: `eve build` green; one dev turn produces an AI trace in Braintrust and a correlated log record in PostHog (manual check with real keys).

## Phase D — Upstash capabilities (after B; parallel with C)

- **D1 Extension**: `eve add extension/upstash-agentkit`; configure `chatHistory: true`. **First action: resolve spec Open Question 1** — inspect `@upstash/agentkit-eve-extension` types for a memory-disable option. If memory cannot be disabled: fall back to dropping the extension and using the package's chat-history capture path; if that forces extension-owned memory instead of standalone files, stop and get sign-off.
- **D2 Deps**: `@upstash/agentkit-eve`, `@upstash/redis`.
- **D3 Tools** (each a single default-exported `define*` call, config inline):
  - `agent/tools/recall_memory.ts` — `defineMemoryRecallTool`
  - `agent/tools/save_memory.ts` — `defineMemorySaveTool`
  - `agent/tools/search.ts` — `defineSearchTools({ schema, indexName }).search`, minimal index schema; document index bootstrap
  - `agent/tools/cached_example.ts` — `defineCachedTool` thin stub, `ttlSeconds: 3600`
- **D4 Rate limit**: prepend `createRateLimitAuth({ limiter: Ratelimit.slidingWindow(20, "1 m"), identifier: principal ?? x-forwarded-for })` to `agent/channels/eve.ts` auth array.
- **D5 Tests**: import-shape smoke tests per tool file.

**Checkpoint D**: `eve info` lists all four tools + extension; build green; rate limit returns 429 past the window in dev.

## Phase E — CI + delivery (last)

- **E1 `.github/workflows/ci.yml`**: pnpm + Node 24 setup → frozen install → biome ci → prettier check → typecheck → knip → vitest coverage → `codecov/codecov-action@v5`.
- **E2 Verify**: push branch, CI green, Codecov gate active, Renovate onboarding PR appears.
- **E3 README**: commands + env var table + user setup steps.

**Checkpoint E** = spec Success Criteria 1–7.

## Risks

| Risk                                                            | Mitigation                                                                               |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| winston default-logger not shared across snapshotted tool files | Verified early (C3); fallback `@opentelemetry/api-logs`                                  |
| Extension memory not toggleable                                 | D1 first action; fallback pre-approved except dropping standalone files (needs sign-off) |
| 95% gate vs untestable wiring files                             | Exclusions mirrored in vitest + codecov, each justified                                  |
| eve build friction with TS 7 / new configs                      | Checkpoint A catches before any feature work                                             |
| Redis Search index absent at first `search` call                | Minimal schema + documented bootstrap step                                               |
| PostHog Logs not enabled on account / wrong region host         | `POSTHOG_HOST` env-driven; manual checkpoint C                                           |

## User-provided items (blockers for full verification)

- `CODECOV_TOKEN` repo secret; Renovate GitHub App installed on repo
- PostHog project token; Braintrust API key + project; Upstash Redis database (URL + token)
