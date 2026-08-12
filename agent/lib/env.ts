import { z } from "zod";

const envSchema = z.object({
  UPSTASH_REDIS_REST_URL: z.url(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1),
  BRAINTRUST_API_KEY: z.string().min(1),
  POSTHOG_HOST: z.url().default("https://us.i.posthog.com"),
  POSTHOG_PROJECT_TOKEN: z.string().min(1),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
