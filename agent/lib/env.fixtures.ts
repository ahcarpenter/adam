/**
 * A complete environment accepted by parseEnv, for tests that need
 * valid credential-shaped values. Only the variables without a default.
 */
export const validEnv = {
  UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "token",
  BRAINTRUST_API_KEY: "key",
  POSTHOG_PROJECT_TOKEN: "phc_token",
};
