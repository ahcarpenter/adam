# Upstash capabilities

- `agent/extensions/agentkit.ts` — single wiring point for long-term
  **memory** (`agentkit__recall_memory`/`agentkit__save_memory`), **RAG** over
  a Redis Search index (`documents` placeholder — replace the schema with
  your domain documents; the index is created reactively on first use), and
  durable **chat history**. See the
  [extension configuration reference](https://upstash.com/docs/redis/sdks/agentkit/eve#extension-configuration-reference).
  Memory and chat history are keyed by the caller's principal id, so a user who
  [signs in](configuration.md#sign-in) has their own. The exception is
  anonymous callers, who all share one principal id and are keyed by session id
  instead (`agent/lib/agentkit-user.ts`), and that anonymous data expires 24
  hours after the session's last turn (`agent/hooks/anonymous-expiry.ts`).
- `agent/channels/eve.ts` — sliding-window rate limit (20 req/min per caller,
  403 over the limit) via `createRateLimitAuth` from `@upstash/agentkit-eve`,
  ahead of the real authenticators.
- For expensive tools, memoize with `defineCachedTool` from
  `@upstash/agentkit-eve` (`agentkit:toolCache:*` keys).

## Adding tools

A tool file in `agent/tools/` may import shared _authored_ helpers from
`agent/lib/` (import-only slot): the four files there do, and
`agent/caller-tools.test.ts` pins that it works in a built and started agent
under eve 0.68. Those four are eve's own shell, file and web-fetch tools,
offered per caller on a deployment open to anonymous callers; see
[Anonymous access](configuration.md#anonymous-access).
