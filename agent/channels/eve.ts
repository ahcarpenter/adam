import { createRateLimitAuth, Ratelimit } from "@upstash/agentkit-eve";
import { localDev, none, placeholderAuth, vercelOidc } from "eve/channels/auth";
import { eveChannel } from "eve/channels/eve";
import { parseEnv } from "#lib/env";
import { ensureLogger } from "#lib/logger";
import { ensureMetrics } from "#lib/metrics";
import { observeRateLimit } from "#lib/observed-auth";

ensureLogger();
ensureMetrics();

const env = parseEnv();

// What a caller no entry above it recognized gets. Closed unless a
// deployment opts in. The placeholder will not allow requests in production:
// it answers eve_production_auth_not_configured until you replace it with
// your app's auth provider, like Auth.js or Clerk.
// ALLOW_ANONYMOUS_ACCESS=true swaps it for none() instead, for a public
// demo: every caller is accepted as the same anonymous principal. Read
// "Anonymous access" in docs/configuration.md before turning that on.
const lastResort = env.ALLOW_ANONYMOUS_ACCESS ? none() : placeholderAuth();

export default eveChannel({
  auth: [
    // Gate, not an identity provider: throttles POSTs (one turn consumes one
    // rate-limit slot) and falls through to the authenticators below when
    // under the limit. Wrapped so a rejection leaves a log line and a metric
    // — it happens before any turn exists, so no trace records it.
    // First in the list, so it also throttles the callers none() accepts.
    observeRateLimit(
      createRateLimitAuth({
        limiter: Ratelimit.slidingWindow(20, "1 m"),
        identifier: (req) => req.headers.get("x-forwarded-for") ?? "anonymous",
      }),
    ),
    // Lets the eve TUI and your Vercel deployments reach the deployed agent.
    vercelOidc(),
    // Open on localhost for `eve dev` and the REPL; ignored in production.
    localDev(),
    // Must stay last: none() accepts every request that reaches it.
    lastResort,
  ],
  // Only lifts eve's trace-content cap; auth, rate limits, delivery unchanged.
  // eve caps content to metadata for private and unknown conversations
  // outside development, after and regardless of the tracePolicy in
  // agent/instrumentation/otel.ts, so the full capture that policy states
  // only holds if every conversation is classified public here.
  audience: "public",
});
