import { afterEach, describe, expect, it, vi } from "vitest";
import { parseEnv } from "./env";
import { validEnv } from "./env.fixtures";

describe("parseEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("parses a valid environment, stripping unknown keys", () => {
    expect(parseEnv({ ...validEnv, UNRELATED_VAR: "ignored" })).toEqual({
      ...validEnv,
      POSTHOG_HOST: "https://us.i.posthog.com",
    });
  });

  it("reads process.env when called without a source", () => {
    for (const [key, value] of Object.entries(validEnv)) vi.stubEnv(key, value);
    vi.stubEnv("POSTHOG_HOST", "https://eu.i.posthog.com");
    expect(parseEnv().POSTHOG_HOST).toBe("https://eu.i.posthog.com");
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
