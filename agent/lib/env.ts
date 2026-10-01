import { z } from "zod";
import { AGENT_NAME } from "./agent-name";

/**
 * winston's default (npm) levels. The set is closed here because winston
 * resolves a level by map lookup — `winston-transport` compares
 * `levels[configured] >= levels[record]`, and an unrecognized key yields
 * `undefined`, so `undefined >= n` is false and *every* record is dropped
 * without a warning. A typo like `LOG_LEVEL=warning` would otherwise be a
 * silent logging outage.
 */
const logLevels = [
  "error",
  "warn",
  "info",
  "http",
  "verbose",
  "debug",
  "silly",
] as const;

const baseSchema = z.object({
  /**
   * The agent's model, routed through the Vercel AI Gateway. There is no
   * gateway credential in this schema on purpose: a Vercel deployment
   * authenticates with the project's OIDC token and sets no variable at all,
   * so requiring one would fail the very deployments that need none.
   */
  AI_GATEWAY_MODEL: z.string().min(1).default("openai/gpt-5"),
  BRAINTRUST_API_KEY: z.string().min(1),
  LOG_LEVEL: z.enum(logLevels).default("info"),
  /**
   * `service.name` on exported logs and metrics. Defaults to the agent name,
   * which is what traces are tagged with; agent/instrumentation/startup.ts
   * reports a mismatch against the name eve actually resolved. eve's trace
   * pipeline reads the same variable, so overriding it moves all three
   * signals together.
   */
  OTEL_SERVICE_NAME: z.string().min(1).default(AGENT_NAME),
  /**
   * Metrics destination. Neither PostHog nor Braintrust ingests OTLP
   * metrics, so the metric pipeline stays off until this points at a
   * collector or metrics backend. Absent, the instruments are no-ops.
   */
  OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional(),
  /**
   * `true` opens the agent to callers who present no credential:
   * agent/channels/eve.ts then ends its auth list with eve's none() instead
   * of the placeholder that rejects production traffic, and agent/agent.ts
   * builds the agent without eve's default tools. Off unless set. The
   * set is closed, and parsed to a real boolean, because a loose read is
   * wrong in both directions: `ture` would leave a demo closed without a
   * word, and the string `false` is truthy.
   */
  ALLOW_ANONYMOUS_ACCESS: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
});

/**
 * Upstash Redis credentials, under either of the two pairs of names that
 * `Redis.fromEnv()` reads. Every Upstash client here is built by that call
 * (AgentKit, its eve extension, and the rate limiter all default to it), so
 * this schema validates the variables and the client reads them itself.
 *
 * The `KV_` pair is what the Upstash store on the Vercel Marketplace sets on
 * a project, which is how the README's Deploy button provisions Redis without
 * asking for a value.
 */
const upstashSchema = z.object({
  UPSTASH_REDIS_REST_URL: z.url(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1),
});

const marketplaceUpstashSchema = z
  .object({
    KV_REST_API_URL: z.url(),
    KV_REST_API_TOKEN: z.string().min(1),
  })
  .transform((kv) => ({
    UPSTASH_REDIS_REST_URL: kv.KV_REST_API_URL,
    UPSTASH_REDIS_REST_TOKEN: kv.KV_REST_API_TOKEN,
  }));

/**
 * PostHog's project token and host, under either of two pairs of names.
 * Nothing but this module reads them: the log exporter and the LLM analytics
 * processor both take the values `parseEnv` returns.
 *
 * The `NEXT_PUBLIC_` pair is what the PostHog integration on the Vercel
 * Marketplace sets on a project that adds it. The README's Deploy button does
 * not provision PostHog, since whether a button can provision that kind of
 * product is unconfirmed. The prefix is only part of the name here, since
 * adam is not a Next.js app. That pair has no default host: the integration
 * always sets one, for the region its token belongs to, and nothing sent to
 * the other region's host reaches the project.
 */
const posthogSchema = z.object({
  POSTHOG_HOST: z.url().default("https://us.i.posthog.com"),
  POSTHOG_PROJECT_TOKEN: z.string().min(1),
});

const marketplacePosthogSchema = z
  .object({
    NEXT_PUBLIC_POSTHOG_HOST: z.url(),
    NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: z.string().min(1),
  })
  .transform((names) => ({
    POSTHOG_HOST: names.NEXT_PUBLIC_POSTHOG_HOST,
    POSTHOG_PROJECT_TOKEN: names.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN,
  }));

export type Env = z.infer<typeof baseSchema> &
  z.infer<typeof upstashSchema> &
  z.infer<typeof posthogSchema>;

/**
 * Whether to hold a pair to its Marketplace names: only when neither of its
 * own names is set and at least one Marketplace name is. A pair is then
 * validated whole, so a half-set one fails naming the missing half instead
 * of pairing a URL with another database's token, or a token with another
 * region's host. Empty counts as unset, as it does for the Upstash client's
 * own `||` fallback.
 */
function usesMarketplaceNames(
  source: NodeJS.ProcessEnv,
  own: readonly string[],
  marketplace: readonly string[],
): boolean {
  if (own.some((name) => source[name])) return false;
  return marketplace.some((name) => source[name]);
}

/**
 * Validates the environment. The Redis credentials come back under the
 * `UPSTASH_` names and the PostHog values under the `POSTHOG_` names,
 * whichever pair supplied them.
 */
export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const upstash = usesMarketplaceNames(
    source,
    ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"],
    ["KV_REST_API_URL", "KV_REST_API_TOKEN"],
  )
    ? marketplaceUpstashSchema
    : upstashSchema;
  const posthog = usesMarketplaceNames(
    source,
    ["POSTHOG_HOST", "POSTHOG_PROJECT_TOKEN"],
    ["NEXT_PUBLIC_POSTHOG_HOST", "NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN"],
  )
    ? marketplacePosthogSchema
    : posthogSchema;
  const result = baseSchema.and(upstash).and(posthog).safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
