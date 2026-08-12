# Tasks: Enterprise Boilerplate

Implements `specs/enterprise-boilerplate.plan.md`. Ordered by dependency. T1–T7 independent; T8 closes Phase A. T9–T10 before T11. T11–T12 (Phase C) and T13–T16 (Phase D) independent of each other. T17–T19 last.

## Phase A — Tooling foundation

- [ ] **T1: Biome setup**
  - Acceptance: `pnpm biome check .` runs clean on existing code; formatter owns TS/JS/JSON; md/yml/css + `node_modules`, `.eve`, `.output`, `.vercel`, `pnpm-lock.yaml` ignored; `lint`/`lint:fix` scripts wired
  - Verify: `pnpm lint` exits 0; `pnpm build` still green
  - Files: `package.json`, `biome.json`

- [ ] **T2: Prettier scoped to md/yml/css**
  - Acceptance: prettier formats only `**/*.{md,yml,yaml,css}`; ignores everything Biome owns; `format`/`format:check` scripts wired (biome + prettier combined)
  - Verify: `pnpm format:check` exits 0; TS file untouched by `pnpm format`
  - Files: `package.json`, `.prettierrc`, `.prettierignore`

- [ ] **T3: Vitest + coverage config**
  - Acceptance: `vitest run` passes with no tests; coverage v8 configured over `lib/**` + `agent/**`; 95% thresholds set; exclusions listed with justification comments; `test`/`test:coverage` scripts wired
  - Verify: `pnpm test` and `pnpm test:coverage` exit 0
  - Files: `package.json`, `vitest.config.ts`

- [ ] **T4: Knip config**
  - Acceptance: knip recognizes eve conventions (default-exported files under `agent/tools|channels|extensions`, `agent/instrumentation.ts` as entries); zero findings on current tree; `knip` script wired
  - Verify: `pnpm knip` exits 0
  - Files: `package.json`, `knip.json`

- [ ] **T5: Renovate config**
  - Acceptance: `renovate.json` extends `config:recommended`; lockfile maintenance on; OTel packages grouped
  - Verify: `npx --yes renovate-config-validator renovate.json` exits 0
  - Files: `renovate.json`

- [ ] **T6: Codecov gate**
  - Acceptance: project status fails < 95%; ignore list mirrors vitest exclusions
  - Verify: YAML valid (curl Codecov validate endpoint or yaml parse)
  - Files: `codecov.yml`

- [ ] **T7: lint-staged + husky pre-commit**
  - Acceptance: staged code files run biome, staged md/yml/css run prettier; badly formatted staged file blocks commit
  - Verify: commit attempt with malformed staged file fails; clean file commits
  - Files: `package.json`, `.lintstagedrc.json`, `.husky/pre-commit`

- [ ] **T8: Checkpoint A**
  - Acceptance: all spec Commands present in `package.json` and green
  - Verify: `pnpm lint && pnpm format:check && pnpm typecheck && pnpm knip && pnpm test && pnpm build` exits 0
  - Files: `package.json` (final reconciliation only)

## Phase B — Env + logging lib

- [ ] **T9: `lib/env.ts` + `.env.example` + tests**
  - Acceptance: zod schema for the five env vars (POSTHOG_HOST defaulted); parse function throws readable error on missing/malformed; tests cover valid/missing/malformed/default
  - Verify: `pnpm test` green; coverage of `lib/env.ts` ≥ 95%
  - Files: `lib/env.ts`, `lib/env.test.ts`, `.env.example`

- [ ] **T10: `lib/logger.ts` + tests**
  - Acceptance: winston helper produces JSON structured output; accepts injectable extra transport (for OTel bridge); configures winston default logger; tests assert output shape and field passthrough
  - Verify: `pnpm test` green; coverage of `lib/logger.ts` ≥ 95%
  - Files: `lib/logger.ts`, `lib/logger.test.ts`, `package.json` (winston dep)

## Phase C — Observability

- [ ] **T11: OTel deps + `agent/instrumentation.ts`**
  - Acceptance: `defineInstrumentation` setup registers Braintrust trace exporter (`filterAISpans: true`) and OTel logs pipeline to PostHog endpoint from validated env; winston bridged via `@opentelemetry/winston-transport`
  - Verify: `pnpm build` green; `eve dev` starts without instrumentation errors
  - Files: `agent/instrumentation.ts`, `package.json`

- [ ] **T12: Winston-sharing verification (spec risk #1)**
  - Acceptance: tool file logging via `import winston from "winston"` provably reaches the startup-configured transports under `eve dev`; if not, tool-file logging switched to `@opentelemetry/api-logs` and spec Decisions Log updated
  - Verify: dev-run log output inspection; decision recorded
  - Files: (verification; possibly `specs/enterprise-boilerplate.md`)

## Phase D — Upstash capabilities

- [ ] **T13: Extension install as directory mount, chat history only**
  - Acceptance: extension installed (`@upstash/agentkit-eve-extension`) as directory mount — `agent/extensions/agentkit/extension.ts` exporting `agentkit({ chatHistory: true })` (no `memory`/`search` config); memory contributions removed via `disableTool()` overrides in `agent/extensions/agentkit/tools/recall_memory.ts` and `save_memory.ts`
  - Verify: `eve info` shows chat-history tools but no `agentkit__recall_memory`/`agentkit__save_memory`; build green
  - Files: `agent/extensions/agentkit/extension.ts`, `agent/extensions/agentkit/tools/recall_memory.ts`, `agent/extensions/agentkit/tools/save_memory.ts`, `package.json`

- [ ] **T14: Memory tools + smoke tests**
  - Acceptance: `recall_memory.ts` (`topK: 5`, `minScore: 1`) and `save_memory.ts` as single default-exported `define*` calls, principal-scoped userId
  - Verify: `eve info` lists both; import-shape tests green
  - Files: `agent/tools/recall_memory.ts`, `agent/tools/save_memory.ts`, `agent/tools/recall_memory.test.ts`, `agent/tools/save_memory.test.ts`

- [ ] **T15: Search + cached tool + smoke tests**
  - Acceptance: `search.ts` via `defineSearchTools({schema, indexName}).search` with minimal schema + bootstrap note; `cached_example.ts` via `defineCachedTool` (`ttlSeconds: 3600`), principal-scoped
  - Verify: `eve info` lists both; import-shape tests green
  - Files: `agent/tools/search.ts`, `agent/tools/cached_example.ts`, `agent/tools/search.test.ts`, `agent/tools/cached_example.test.ts`

- [ ] **T16: Rate limit in channel auth**
  - Acceptance: `createRateLimitAuth` (sliding window 20/1m, principal-or-IP identifier) prepended to `agent/channels/eve.ts` auth array
  - Verify: `pnpm build` green; dev-run: request past window returns 429
  - Files: `agent/channels/eve.ts`

## Phase E — CI + delivery

- [ ] **T17: GitHub Actions workflow**
  - Acceptance: `ci.yml` — pnpm/Node 24 setup, frozen install, biome ci, prettier check, typecheck, knip, vitest coverage, codecov-action@v5 upload
  - Verify: `actionlint` (or push) passes
  - Files: `.github/workflows/ci.yml`

- [ ] **T18: README**
  - Acceptance: commands table, env var table, user setup steps (Codecov token, Renovate app, PostHog/Braintrust/Upstash provisioning)
  - Verify: prettier check green; steps match spec
  - Files: `README.md`

- [ ] **T19: Push + end-to-end verification**
  - Acceptance: branch pushed; CI green; Codecov gate active; Renovate onboarding PR opened; spec Success Criteria 1–3, 7 met (4–6 need user credentials — report status honestly)
  - Verify: GitHub checks UI / `gh run watch`
  - Files: none
