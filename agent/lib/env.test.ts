import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

const validEnv = {
  OPENAI_API_KEY: "sk-test",
  OPENAI_MODEL: "gpt-5",
  UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "token",
  BRAINTRUST_API_KEY: "key",
  POSTHOG_PROJECT_TOKEN: "phc_token",
};

describe("parseEnv", () => {
  it("parses a valid environment", () => {
    const env = parseEnv(validEnv);
    expect(env.UPSTASH_REDIS_REST_URL).toBe("https://example.upstash.io");
    expect(env.POSTHOG_PROJECT_TOKEN).toBe("phc_token");
  });

  it("defaults POSTHOG_HOST to US cloud", () => {
    expect(parseEnv(validEnv).POSTHOG_HOST).toBe("https://us.i.posthog.com");
  });

  it("keeps an explicit POSTHOG_HOST", () => {
    const env = parseEnv({
      ...validEnv,
      POSTHOG_HOST: "https://eu.i.posthog.com",
    });
    expect(env.POSTHOG_HOST).toBe("https://eu.i.posthog.com");
  });

  it("throws a readable error listing missing variables", () => {
    expect(() => parseEnv({})).toThrow(/Invalid environment/);
    expect(() => parseEnv({})).toThrow(/UPSTASH_REDIS_REST_URL/);
    expect(() => parseEnv({})).toThrow(/OPENAI_API_KEY/);
    expect(() => parseEnv({})).toThrow(/OPENAI_MODEL/);
  });

  it("rejects malformed URLs", () => {
    expect(() =>
      parseEnv({ ...validEnv, UPSTASH_REDIS_REST_URL: "not-a-url" }),
    ).toThrow(/UPSTASH_REDIS_REST_URL/);
  });

  it("rejects empty tokens", () => {
    expect(() =>
      parseEnv({ ...validEnv, UPSTASH_REDIS_REST_TOKEN: "" }),
    ).toThrow(/UPSTASH_REDIS_REST_TOKEN/);
  });
});
