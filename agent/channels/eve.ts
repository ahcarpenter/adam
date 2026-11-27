import { createRateLimitAuth, Ratelimit } from "@upstash/agentkit-eve";
import {
  type AuthFn,
  localDev,
  none,
  placeholderAuth,
  vercelOidc,
} from "eve/channels/auth";
import { eveChannel } from "eve/channels/eve";
import { type Env, parseEnv } from "#lib/env";
import { ensureLogger } from "#lib/logger";
import { ensureMetrics } from "#lib/metrics";
import { observeRateLimit } from "#lib/observed-auth";
import { vercelSignIn } from "#lib/vercel-sign-in";

ensureLogger();
ensureMetrics();

const env = parseEnv();

// Sign in with Vercel, present only when a deployment sets its app's client
// ID. A caller who presents an ID token Vercel issued to that app is a named
// user with their own memory and chat history. Read "Sign-in" in
// docs/configuration.md. To use another identity provider, replace this one
// entry with its authenticator.
function signIn({ VERCEL_APP_CLIENT_ID }: Env): AuthFn<Request>[] {
  return VERCEL_APP_CLIENT_ID
    ? [vercelSignIn({ clientId: VERCEL_APP_CLIENT_ID })]
    : [];
}

// What a caller no entry above it recognized gets. Closed unless a
// deployment opts in.
// ALLOW_ANONYMOUS_ACCESS=true ends the list with none(), for a public demo:
// every caller left is accepted as the same anonymous principal, and
// agent/agent.ts builds the agent without eve's default tools. Read
// "Anonymous access" in docs/configuration.md before turning that on.
// Otherwise, with sign-in configured, nothing follows: the walk runs out and
// eve answers a plain 401 with a Bearer challenge.
// With neither, the placeholder stays. It will not allow requests in
// production: it answers eve_production_auth_not_configured until a
// deployment configures sign-in or you put your own auth provider in.
function lastResort(env: Env): AuthFn<Request>[] {
  if (env.ALLOW_ANONYMOUS_ACCESS) return [none()];
  return env.VERCEL_APP_CLIENT_ID ? [] : [placeholderAuth()];
}

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
    ...signIn(env),
    // Open on localhost for `eve dev` and the REPL; ignored in production.
    localDev(),
    // Must stay last: none() accepts every request that reaches it.
    ...lastResort(env),
  ],
  // Tracing only; auth, rate limits and delivery are unchanged. The
  // tracePolicy in agent/instrumentation/otel.ts records content for every
  // audience, but outside development eve records the caller's principal ids
  // on spans, and shows the session's workflow run content, only for public
  // conversations. Classifying every conversation public keeps both, so the
  // traces Braintrust and PostHog receive name their user (agent-runs.ts
  // strips the ids for Vercel Agent Runs). That covers a signed-in user's
  // conversations too. This one line is where that is decided.
  audience: "public",
});
