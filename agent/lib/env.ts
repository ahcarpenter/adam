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
  POSTHOG_HOST: z.url().default("https://us.i.posthog.com"),
  POSTHOG_PROJECT_TOKEN: z.string().min(1),
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
const upstashSchema = baseSchema.extend({
  UPSTASH_REDIS_REST_URL: z.url(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1),
});

const marketplaceSchema = baseSchema.extend({
  KV_REST_API_URL: z.url(),
  KV_REST_API_TOKEN: z.string().min(1),
});

export type Env = z.infer<typeof upstashSchema>;

/**
 * Whether to hold the environment to the Marketplace's `KV_` pair: only when
 * neither `UPSTASH_` name is set and at least one `KV_` name is. A pair is
 * then validated whole, so a half-set one fails naming the missing half
 * instead of letting the client pair a URL with another database's token.
 * Empty counts as unset, as it does for the client's own `||` fallback.
 */
function usesMarketplaceNames(source: NodeJS.ProcessEnv): boolean {
  if (source.UPSTASH_REDIS_REST_URL || source.UPSTASH_REDIS_REST_TOKEN) {
    return false;
  }
  return Boolean(source.KV_REST_API_URL || source.KV_REST_API_TOKEN);
}

function invalid(error: z.ZodError): Error {
  return new Error(`Invalid environment:\n${z.prettifyError(error)}`);
}

/**
 * Validates the environment. The Redis credentials come back under the
 * `UPSTASH_` names whichever pair supplied them.
 */
export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (usesMarketplaceNames(source)) {
    const result = marketplaceSchema.safeParse(source);
    if (!result.success) throw invalid(result.error);
    const { KV_REST_API_URL, KV_REST_API_TOKEN, ...rest } = result.data;
    return {
      ...rest,
      UPSTASH_REDIS_REST_URL: KV_REST_API_URL,
      UPSTASH_REDIS_REST_TOKEN: KV_REST_API_TOKEN,
    };
  }
  const result = upstashSchema.safeParse(source);
  if (!result.success) throw invalid(result.error);
  return result.data;
}
