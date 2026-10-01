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

const envSchema = z.object({
  /**
   * The agent's model, routed through the Vercel AI Gateway. There is no
   * gateway credential in this schema on purpose: a Vercel deployment
   * authenticates with the project's OIDC token and sets no variable at all,
   * so requiring one would fail the very deployments that need none.
   */
  AI_GATEWAY_MODEL: z.string().min(1).default("openai/gpt-5"),
  UPSTASH_REDIS_REST_URL: z.url(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1),
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

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
