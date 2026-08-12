# adam — enterprise eve agent boilerplate

An [eve](https://eve.dev) agent with enterprise tooling, observability, and
Upstash-backed capabilities wired in as a minimal skeleton. Spec, plan, and
task history live in [`specs/`](specs/enterprise-boilerplate.md).

## Stack

| Concern                                               | Tool                                       |
| ----------------------------------------------------- | ------------------------------------------ |
| Lint + format (TS/JS/JSON)                            | Biome                                      |
| Format (md/yml/css)                                   | Prettier                                   |
| Tests + coverage                                      | Vitest (v8), 95% thresholds                |
| Coverage gate                                         | Codecov (95% project/patch)                |
| Dead code / unused deps                               | Knip                                       |
| Dependency automation                                 | Renovate                                   |
| Structured logging                                    | winston → OTel logs → PostHog              |
| Tracing                                               | `@vercel/otel`; AI spans only → Braintrust |
| Memory / RAG / chat history / rate limit / tool cache | Upstash Redis (AgentKit)                   |

## Commands

```
pnpm dev            # eve dev (TUI at http://127.0.0.1:2000)
pnpm build          # eve build
pnpm typecheck      # tsc
pnpm lint           # biome check .
pnpm lint:fix       # biome check --write .
pnpm format         # biome format --write + prettier --write (md/yml/css)
pnpm format:check   # biome ci + prettier --check (CI mode)
pnpm test           # vitest run
pnpm test:coverage  # vitest run --coverage (95% thresholds)
pnpm knip           # dead code / unused dependency scan
```

## Environment

Copy `env.example` to `.env.local` and fill in:

| Variable                                              | Purpose                                                      |
| ----------------------------------------------------- | ------------------------------------------------------------ |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Memory, RAG, chat history, rate limiting, tool cache         |
| `BRAINTRUST_API_KEY`                                  | AI trace export                                              |
| `POSTHOG_HOST`                                        | PostHog region host (defaults to `https://us.i.posthog.com`) |
| `POSTHOG_PROJECT_TOKEN`                               | Log export                                                   |

Local dev degrades gracefully without these (console-only logging, a warning
at startup); production fails fast on an invalid environment.

## Observability design

`agent/instrumentation.ts` is the single wiring point:

- **Logs** — winston's default logger is configured at startup (JSON console +
  OTel bridge). Every authored file logs through `import winston from
"winston"`; records emitted inside a span carry trace/span ids into PostHog.
- **Traces** — `BraintrustExporter({ filterAISpans: true })`: only AI spans
  reach Braintrust.

## Upstash capabilities

- `agent/extensions/agentkit/` — extension mount scoped to durable **chat
  history**; its default memory/search tools are disabled via `disableTool()`
  overrides.
- `agent/tools/recall_memory.ts`, `save_memory.ts` — long-term memory.
- `agent/tools/search.ts` — RAG over a Redis Search index (`documents`
  placeholder; the index is created reactively on first use — replace the
  schema with your domain documents).
- `agent/tools/cached_example.ts` — Redis-memoized tool pattern
  (`agentkit:toolCache:*` keys, 1h TTL).
- `agent/channels/eve.ts` — sliding-window rate limit (20 req/min per caller,
  403 over the limit) ahead of the real authenticators.

Eve snapshots tool files and resolves only package imports, so each tool file
is self-contained — repeat config rather than importing shared `agent/`
modules. Shared _authored_ helpers belong in `agent/lib/` (import-only slot).

## One-time setup (repo owner)

1. **Codecov**: add the `CODECOV_TOKEN` repository secret — activates the 95%
   coverage gate in CI.
2. **Renovate**: install the Renovate GitHub App on this repo — it picks up
   `renovate.json` and opens an onboarding PR.
3. **Upstash / Braintrust / PostHog**: provision and set the env vars above
   (locally in `.env.local`, on Vercel via `vercel env`).
