import { type AuthFn, routeAuth } from "eve/channels/auth";
import { afterEach, describe, expect, it, vi } from "vitest";
import winston from "winston";
import { validEnv } from "#lib/env.fixtures";

vi.mock("#lib/logger", () => ({ ensureLogger: () => {} }));
vi.mock("#lib/metrics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("#lib/metrics")>()),
  ensureMetrics: () => {},
}));

// eve keeps the auth list inside the route handlers it builds, so the walk
// is run here through eve's own routeAuth over the list the channel passed
// to eveChannel, which is otherwise left to build the real channel.
const walks = vi.hoisted(() => [] as (readonly AuthFn<Request>[])[]);
vi.mock("eve/channels/eve", async (importOriginal) => {
  const actual = await importOriginal<typeof import("eve/channels/eve")>();
  return {
    ...actual,
    eveChannel: (config: Parameters<typeof actual.eveChannel>[0]) => {
      walks.push(config.auth as readonly AuthFn<Request>[]);
      return actual.eveChannel(config);
    },
  };
});

type Setting = "true" | "false" | undefined;

// The environments eve's auth helpers tell apart: placeholderAuth() rejects
// only where VERCEL_ENV is production, and localDev() accepts only under
// `eve dev`.
const environments = {
  production: { VERCEL_ENV: "production", EVE_DEV: undefined },
  preview: { VERCEL_ENV: "preview", EVE_DEV: undefined },
  "eve dev": { VERCEL_ENV: undefined, EVE_DEV: "1" },
} as const;
type Environment = keyof typeof environments;

/**
 * Evaluates agent/channels/eve.ts afresh under one state of the setting, as
 * a deployment does at startup, and returns the built channel with the auth
 * list it was given.
 */
async function loadChannel(
  setting: Setting,
  environment: Environment = "production",
) {
  vi.resetModules();
  for (const [key, value] of Object.entries({
    ...validEnv,
    ...environments[environment],
    VERCEL: undefined,
    ALLOW_ANONYMOUS_ACCESS: setting,
  })) {
    vi.stubEnv(key, value);
  }
  const { default: channel } = await import("./eve");
  const auth = walks.at(-1);
  if (!auth) throw new Error("the channel did not call eveChannel");
  return { channel, auth };
}

/**
 * Stands in for Upstash's REST endpoint, the only thing the rate limiter
 * talks to. It counts requests per address as the limiter's script does
 * inside one window and answers with the script's [remaining, limit].
 */
function stubUpstash() {
  const used = new Map<string, number>();
  const commands: (string | number)[][] = [];
  vi.stubGlobal("fetch", async (_url: unknown, init: { body: string }) => {
    const pipeline = JSON.parse(init.body) as (string | number)[][];
    return Response.json(
      pipeline.map((command) => {
        commands.push(command);
        const windowKey = String(command[3]);
        const tokens = Number(command[5]);
        const address = windowKey.slice(0, windowKey.lastIndexOf(":"));
        const count = (used.get(address) ?? 0) + 1;
        used.set(address, count);
        return {
          result: count > tokens ? [-1, tokens] : [tokens - count, tokens],
        };
      }),
    );
  });
  return commands;
}

const origin = "https://adam.example";

function createSession(address = "203.0.113.7") {
  return new Request(`${origin}/eve/v1/session`, {
    method: "POST",
    headers: { "x-forwarded-for": address },
  });
}

// What eve's none() returns for every caller it accepts.
const anonymous = {
  attributes: {},
  authenticator: "none",
  principalId: "anonymous",
  principalType: "anonymous",
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  walks.length = 0;
});

describe("eve channel access", () => {
  describe.each<Setting>([undefined, "false"])(
    "with ALLOW_ANONYMOUS_ACCESS=%s",
    (setting) => {
      it("answers production callers with eve's placeholder 401", async () => {
        stubUpstash();
        const { auth } = await loadChannel(setting, "production");

        for (const request of [
          new Request(`${origin}/eve/v1/info`),
          createSession(),
        ]) {
          const response = await routeAuth(request, auth);

          expect(response).toBeInstanceOf(Response);
          expect((response as Response).status).toBe(401);
          await expect((response as Response).json()).resolves.toMatchObject({
            code: "eve_production_auth_not_configured",
            ok: false,
          });
        }
      });

      it("turns preview callers away with a plain 401", async () => {
        const { auth } = await loadChannel(setting, "preview");

        const response = await routeAuth(
          new Request(`${origin}/eve/v1/info`),
          auth,
        );

        expect(response).toBeInstanceOf(Response);
        expect((response as Response).status).toBe(401);
        await expect((response as Response).json()).resolves.toMatchObject({
          code: "unauthorized",
          ok: false,
        });
      });

      it("stays open to the local development server", async () => {
        const { auth } = await loadChannel(setting, "eve dev");

        await expect(
          routeAuth(new Request(`${origin}/eve/v1/info`), auth),
        ).resolves.toMatchObject({ principalId: "local-dev" });
      });
    },
  );

  describe("with ALLOW_ANONYMOUS_ACCESS=true", () => {
    it.each<Environment>(["production", "preview"])(
      "accepts a %s caller with no credential as anonymous",
      async (environment) => {
        stubUpstash();
        const { auth } = await loadChannel("true", environment);

        for (const request of [
          new Request(`${origin}/eve/v1/info`),
          createSession(),
        ]) {
          await expect(routeAuth(request, auth)).resolves.toEqual(anonymous);
        }
      },
    );

    it("still identifies the local development server", async () => {
      const { auth } = await loadChannel("true", "eve dev");

      await expect(
        routeAuth(new Request(`${origin}/eve/v1/info`), auth),
      ).resolves.toMatchObject({ principalId: "local-dev" });
    });

    it("holds anonymous callers to 20 requests a minute per address", async () => {
      const commands = stubUpstash();
      const warn = vi
        .spyOn(winston, "warn")
        .mockImplementation(() => winston as never);
      const { auth } = await loadChannel("true", "production");

      for (let turn = 1; turn <= 20; turn++) {
        await expect(routeAuth(createSession(), auth)).resolves.toEqual(
          anonymous,
        );
      }
      const throttled = await routeAuth(createSession(), auth);

      expect(throttled).toBeInstanceOf(Response);
      expect((throttled as Response).status).toBe(403);
      // What the channel asked Upstash to enforce: 20 tokens per 60 s.
      const [, , , , , tokens, , windowMs] = commands[0] ?? [];
      expect({ tokens, windowMs }).toEqual({ tokens: 20, windowMs: 60_000 });
      expect(warn).toHaveBeenCalledWith(
        "rate limit rejected request",
        expect.objectContaining({ event: "rate_limit_rejected" }),
      );
      // The window is per address, and only message submissions spend it.
      await expect(
        routeAuth(createSession("198.51.100.4"), auth),
      ).resolves.toEqual(anonymous);
      await expect(
        routeAuth(
          new Request(`${origin}/eve/v1/session/s1/stream`, {
            headers: { "x-forwarded-for": "203.0.113.7" },
          }),
          auth,
        ),
      ).resolves.toEqual(anonymous);
    });
  });

  it("fails startup on a value outside the closed set", async () => {
    await expect(loadChannel("ture" as Setting)).rejects.toThrow(
      /ALLOW_ANONYMOUS_ACCESS/,
    );
  });
});

// eve caps trace content to metadata for private and unknown conversations
// outside development, whatever agent/instrumentation/otel.ts's tracePolicy
// says. The full capture that policy pins (docs/observability.md,
// SECURITY.md) therefore depends on this channel classifying every
// conversation public. eve does not expose the classifier on the public
// Channel type, so this reads the one its runtime calls at session creation.
type AudienceClassifier = (input: {
  caller: unknown;
  auth: unknown;
  channel: { kind: string };
  environment: string;
  state: undefined;
}) => string;

const callers = [
  { name: "anonymous", caller: { type: "anonymous" }, auth: null },
  {
    name: "authenticated user",
    caller: {
      type: "principal",
      principal: { kind: "user", authenticator: "vercel-oidc", attributes: {} },
    },
    auth: {
      principalType: "user",
      authenticator: "vercel-oidc",
      attributes: {},
    },
  },
] as const;

describe.each<Setting>([undefined, "true"])(
  "eve channel trace audience with ALLOW_ANONYMOUS_ACCESS=%s",
  (setting) => {
    it.each(
      ["development", "preview", "production"].flatMap((environment) =>
        callers.map((c) => ({ ...c, environment })),
      ),
    )(
      "classifies $name conversations in $environment as public",
      async ({ caller, auth, environment }) => {
        const { channel } = await loadChannel(setting);
        const classify = (
          channel as unknown as {
            adapter: { instrumentation: { audience: AudienceClassifier } };
          }
        ).adapter.instrumentation.audience;

        expect(
          classify({
            caller,
            auth,
            channel: { kind: "channel:eve" },
            environment,
            state: undefined,
          }),
        ).toBe("public");
      },
    );
  },
);
