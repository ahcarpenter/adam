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
      AI_GATEWAY_MODEL: "openai/gpt-5",
      POSTHOG_HOST: "https://us.i.posthog.com",
      LOG_LEVEL: "info",
      OTEL_SERVICE_NAME: "adam",
      ALLOW_ANONYMOUS_ACCESS: false,
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
    expect(() => parseEnv({})).toThrow(/UPSTASH_REDIS_REST_TOKEN/);
    expect(() => parseEnv({})).toThrow(/BRAINTRUST_API_KEY/);
    expect(() => parseEnv({})).toThrow(/POSTHOG_PROJECT_TOKEN/);
  });

  // validEnv carries no model and no gateway credential: a Vercel deployment
  // authenticates to the gateway with its OIDC token and sets neither.
  it("defaults the model with no model variable or gateway credential", () => {
    expect(parseEnv(validEnv).AI_GATEWAY_MODEL).toBe("openai/gpt-5");
  });

  it("keeps an explicit gateway model", () => {
    expect(
      parseEnv({ ...validEnv, AI_GATEWAY_MODEL: "anthropic/claude-sonnet-5" })
        .AI_GATEWAY_MODEL,
    ).toBe("anthropic/claude-sonnet-5");
  });

  it("rejects an empty gateway model", () => {
    expect(() => parseEnv({ ...validEnv, AI_GATEWAY_MODEL: "" })).toThrow(
      /AI_GATEWAY_MODEL/,
    );
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

  it("keeps a winston log level", () => {
    expect(parseEnv({ ...validEnv, LOG_LEVEL: "debug" }).LOG_LEVEL).toBe(
      "debug",
    );
  });

  it.each(["warning", "INFO", "trace"])(
    "rejects %s, which winston would silently drop every record for",
    (level) => {
      expect(() => parseEnv({ ...validEnv, LOG_LEVEL: level })).toThrow(
        /LOG_LEVEL/,
      );
    },
  );

  it("keeps an explicit service name", () => {
    expect(
      parseEnv({ ...validEnv, OTEL_SERVICE_NAME: "adam-worker" })
        .OTEL_SERVICE_NAME,
    ).toBe("adam-worker");
  });

  it("leaves the metrics endpoint unset by default", () => {
    expect(parseEnv(validEnv).OTEL_EXPORTER_OTLP_ENDPOINT).toBeUndefined();
  });

  it("rejects a malformed metrics endpoint", () => {
    expect(() =>
      parseEnv({ ...validEnv, OTEL_EXPORTER_OTLP_ENDPOINT: "collector" }),
    ).toThrow(/OTEL_EXPORTER_OTLP_ENDPOINT/);
  });

  it("keeps anonymous access off unless a deployment turns it on", () => {
    expect(parseEnv(validEnv).ALLOW_ANONYMOUS_ACCESS).toBe(false);
  });

  it.each([
    ["true", true],
    ["false", false],
  ])("parses ALLOW_ANONYMOUS_ACCESS=%s to the boolean %s", (value, parsed) => {
    expect(
      parseEnv({ ...validEnv, ALLOW_ANONYMOUS_ACCESS: value })
        .ALLOW_ANONYMOUS_ACCESS,
    ).toBe(parsed);
  });

  // A typo must fail startup, not decide access: read loosely, "ture" would
  // leave a demo closed without a word, and "0" or "no" would open one.
  it.each(["ture", "TRUE", "1", "yes", "on", "open", "0", "no", ""])(
    "rejects ALLOW_ANONYMOUS_ACCESS=%j rather than guessing",
    (value) => {
      expect(() =>
        parseEnv({ ...validEnv, ALLOW_ANONYMOUS_ACCESS: value }),
      ).toThrow(/ALLOW_ANONYMOUS_ACCESS/);
    },
  );
});
