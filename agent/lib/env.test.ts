import { Redis } from "@upstash/redis";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseEnv } from "./env";
import { validEnv } from "./env.fixtures";

const { UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, ...withoutRedis } =
  validEnv;

/** What the Upstash store on the Vercel Marketplace sets on a project. */
const marketplaceEnv = {
  ...withoutRedis,
  KV_REST_API_URL: "https://marketplace.upstash.io",
  KV_REST_API_TOKEN: "marketplace-token",
};

const { POSTHOG_PROJECT_TOKEN, ...withoutPosthog } = validEnv;

/**
 * What the PostHog integration on the Vercel Marketplace sets on a project.
 * The host is the EU one so that a fallback to the US default would show.
 */
const posthogMarketplaceEnv = {
  ...withoutPosthog,
  NEXT_PUBLIC_POSTHOG_HOST: "https://eu.i.posthog.com",
  NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: "phc_marketplace",
};

describe("parseEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
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

  describe("Vercel Marketplace names for Upstash", () => {
    it("accepts the KV_ pair when the UPSTASH_ pair is absent", () => {
      const env = parseEnv(marketplaceEnv);
      expect(env.UPSTASH_REDIS_REST_URL).toBe(marketplaceEnv.KV_REST_API_URL);
      expect(env.UPSTASH_REDIS_REST_TOKEN).toBe(
        marketplaceEnv.KV_REST_API_TOKEN,
      );
      expect(env).not.toHaveProperty("KV_REST_API_URL");
      expect(env).not.toHaveProperty("KV_REST_API_TOKEN");
    });

    it("prefers the UPSTASH_ pair when both are present", () => {
      const env = parseEnv({ ...marketplaceEnv, ...validEnv });
      expect(env.UPSTASH_REDIS_REST_URL).toBe(UPSTASH_REDIS_REST_URL);
      expect(env.UPSTASH_REDIS_REST_TOKEN).toBe(UPSTASH_REDIS_REST_TOKEN);
    });

    it("treats an empty UPSTASH_ pair as absent, as the client does", () => {
      const env = parseEnv({
        ...marketplaceEnv,
        UPSTASH_REDIS_REST_URL: "",
        UPSTASH_REDIS_REST_TOKEN: "",
      });
      expect(env.UPSTASH_REDIS_REST_URL).toBe(marketplaceEnv.KV_REST_API_URL);
    });

    it.each([
      ["KV_REST_API_URL", "KV_REST_API_TOKEN"],
      ["KV_REST_API_TOKEN", "KV_REST_API_URL"],
    ] as const)("names %s when only %s is set", (missing, present) => {
      const source = { ...withoutRedis, [present]: marketplaceEnv[present] };
      expect(() => parseEnv(source)).toThrow(new RegExp(missing));
      expect(() => parseEnv(source)).not.toThrow(/UPSTASH_REDIS_REST/);
    });

    // The client would otherwise pair this URL with the KV_ token.
    it.each([
      ["UPSTASH_REDIS_REST_TOKEN", "UPSTASH_REDIS_REST_URL"],
      ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"],
    ] as const)(
      "names %s when only %s is set, even beside a whole KV_ pair",
      (missing, present) => {
        const source = { ...marketplaceEnv, [present]: validEnv[present] };
        expect(() => parseEnv(source)).toThrow(new RegExp(missing));
        expect(() => parseEnv(source)).not.toThrow(/KV_REST_API/);
      },
    );

    it("rejects a malformed KV_REST_API_URL", () => {
      expect(() =>
        parseEnv({ ...marketplaceEnv, KV_REST_API_URL: "not-a-url" }),
      ).toThrow(/KV_REST_API_URL/);
    });

    // parseEnv only validates: AgentKit and the rate limiter build their
    // client with Redis.fromEnv(). This holds the two to the same answer, so
    // an environment that passes validation is one the client connects with.
    it.each([
      ["only the KV_ pair", marketplaceEnv],
      ["only the UPSTASH_ pair", validEnv],
      ["both pairs", { ...marketplaceEnv, ...validEnv }],
    ])(
      "matches what Redis.fromEnv() connects with, given %s",
      async (_, source) => {
        for (const name of [
          "UPSTASH_REDIS_REST_URL",
          "UPSTASH_REDIS_REST_TOKEN",
          "KV_REST_API_URL",
          "KV_REST_API_TOKEN",
        ]) {
          vi.stubEnv(name, undefined);
        }
        for (const [key, value] of Object.entries(source))
          vi.stubEnv(key, value);
        const fetchMock = vi.fn(async (..._args: Parameters<typeof fetch>) =>
          Response.json({ result: "PONG" }),
        );
        vi.stubGlobal("fetch", fetchMock);

        await Redis.fromEnv({
          enableTelemetry: false,
          enableAutoPipelining: false,
        }).ping();

        const env = parseEnv();
        const [url, init] = fetchMock.mock.calls[0] ?? [];
        expect(new URL(String(url)).origin).toBe(env.UPSTASH_REDIS_REST_URL);
        expect(new Headers(init?.headers).get("authorization")).toBe(
          `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}`,
        );
      },
    );
  });

  describe("Vercel Marketplace names for PostHog", () => {
    it("accepts the NEXT_PUBLIC_ pair when the POSTHOG_ pair is absent", () => {
      const env = parseEnv(posthogMarketplaceEnv);
      expect(env.POSTHOG_PROJECT_TOKEN).toBe(
        posthogMarketplaceEnv.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN,
      );
      expect(env.POSTHOG_HOST).toBe(
        posthogMarketplaceEnv.NEXT_PUBLIC_POSTHOG_HOST,
      );
      expect(env).not.toHaveProperty("NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN");
      expect(env).not.toHaveProperty("NEXT_PUBLIC_POSTHOG_HOST");
    });

    it("prefers the POSTHOG_ pair when both are present", () => {
      const env = parseEnv({
        ...posthogMarketplaceEnv,
        POSTHOG_PROJECT_TOKEN,
        POSTHOG_HOST: "https://us.posthog.example",
      });
      expect(env.POSTHOG_PROJECT_TOKEN).toBe(POSTHOG_PROJECT_TOKEN);
      expect(env.POSTHOG_HOST).toBe("https://us.posthog.example");
    });

    // A token set by hand belongs to the default region unless a host is set
    // beside it, never to the region of the integration's token.
    it("keeps the default host for a POSTHOG_ token beside a NEXT_PUBLIC_ pair", () => {
      const env = parseEnv({ ...posthogMarketplaceEnv, POSTHOG_PROJECT_TOKEN });
      expect(env.POSTHOG_PROJECT_TOKEN).toBe(POSTHOG_PROJECT_TOKEN);
      expect(env.POSTHOG_HOST).toBe("https://us.i.posthog.com");
    });

    it("treats an empty POSTHOG_ pair as absent", () => {
      const env = parseEnv({
        ...posthogMarketplaceEnv,
        POSTHOG_PROJECT_TOKEN: "",
        POSTHOG_HOST: "",
      });
      expect(env.POSTHOG_PROJECT_TOKEN).toBe(
        posthogMarketplaceEnv.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN,
      );
      expect(env.POSTHOG_HOST).toBe(
        posthogMarketplaceEnv.NEXT_PUBLIC_POSTHOG_HOST,
      );
    });

    it.each([
      ["NEXT_PUBLIC_POSTHOG_HOST", "NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN"],
      ["NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN", "NEXT_PUBLIC_POSTHOG_HOST"],
    ] as const)("names %s when only %s is set", (missing, present) => {
      const source = {
        ...withoutPosthog,
        [present]: posthogMarketplaceEnv[present],
      };
      expect(() => parseEnv(source)).toThrow(new RegExp(missing));
      expect(() => parseEnv(source)).not.toThrow(/at POSTHOG_/);
    });

    // The integration's token would otherwise be sent to this host.
    it("names POSTHOG_PROJECT_TOKEN when only POSTHOG_HOST is set, even beside a whole NEXT_PUBLIC_ pair", () => {
      const source = {
        ...posthogMarketplaceEnv,
        POSTHOG_HOST: "https://us.i.posthog.com",
      };
      expect(() => parseEnv(source)).toThrow(/at POSTHOG_PROJECT_TOKEN/);
      expect(() => parseEnv(source)).not.toThrow(/NEXT_PUBLIC_POSTHOG/);
    });

    it("rejects a malformed NEXT_PUBLIC_POSTHOG_HOST", () => {
      expect(() =>
        parseEnv({
          ...posthogMarketplaceEnv,
          NEXT_PUBLIC_POSTHOG_HOST: "eu.i.posthog.com",
        }),
      ).toThrow(/NEXT_PUBLIC_POSTHOG_HOST/);
    });

    // A project with both Marketplace integrations added: both stores' names,
    // and the Braintrust key.
    it("accepts a deployment that has only the Marketplace names", () => {
      expect(
        parseEnv({
          BRAINTRUST_API_KEY: validEnv.BRAINTRUST_API_KEY,
          KV_REST_API_URL: marketplaceEnv.KV_REST_API_URL,
          KV_REST_API_TOKEN: marketplaceEnv.KV_REST_API_TOKEN,
          NEXT_PUBLIC_POSTHOG_HOST:
            posthogMarketplaceEnv.NEXT_PUBLIC_POSTHOG_HOST,
          NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN:
            posthogMarketplaceEnv.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN,
        }),
      ).toEqual({
        AI_GATEWAY_MODEL: "openai/gpt-5",
        BRAINTRUST_API_KEY: validEnv.BRAINTRUST_API_KEY,
        UPSTASH_REDIS_REST_URL: marketplaceEnv.KV_REST_API_URL,
        UPSTASH_REDIS_REST_TOKEN: marketplaceEnv.KV_REST_API_TOKEN,
        POSTHOG_HOST: posthogMarketplaceEnv.NEXT_PUBLIC_POSTHOG_HOST,
        POSTHOG_PROJECT_TOKEN:
          posthogMarketplaceEnv.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN,
        LOG_LEVEL: "info",
        OTEL_SERVICE_NAME: "adam",
      });
    });
  });
});
