# Upstash capabilities

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

## Adding tools

Eve snapshots tool files and resolves only package imports, so any future
`agent/tools/*.ts` file must be self-contained — repeat config rather than
importing shared `agent/` modules. Shared _authored_ helpers belong in
`agent/lib/` (import-only slot).
