import { type AuthFn, routeAuth } from "eve/channels/auth";
import { afterEach, describe, expect, it, vi } from "vitest";
import winston from "winston";
import { validEnv } from "#lib/env.fixtures";
import { VERCEL_SIGN_IN_ISSUER } from "#lib/vercel-sign-in";
import { createSigner, issuerDocuments } from "#lib/vercel-sign-in.fixtures";

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
 * Evaluates agent/channels/eve.ts afresh under one state of its two access
 * settings, as a deployment does at startup, and returns the built channel
 * with the auth list it was given.
 */
async function loadChannel(
  setting: Setting,
  environment: Environment = "production",
  appClientId?: string,
) {
  vi.resetModules();
  for (const [key, value] of Object.entries({
    ...validEnv,
    ...environments[environment],
    VERCEL: undefined,
    ALLOW_ANONYMOUS_ACCESS: setting,
    VERCEL_APP_CLIENT_ID: appClientId,
  })) {
    vi.stubEnv(key, value);
  }
  const { default: channel } = await import("./eve");
  const auth = walks.at(-1);
  if (!auth) throw new Error("the channel did not call eveChannel");
  return { channel, auth };
}

// Stands in for Vercel as the issuer of sign-in tokens: the channel verifies
// against https://vercel.com, so its two documents are answered from here
// and the tokens below are signed with this key. One key for the whole file,
// because eve caches an issuer's keys for the life of the process.
const vercel = createSigner();
const vercelDocuments = issuerDocuments(VERCEL_SIGN_IN_ISSUER, vercel);
const clientId = "cl_adam_test";

function idToken(claims: Record<string, unknown> = {}) {
  return vercel.idToken({
    iss: VERCEL_SIGN_IN_ISSUER,
    aud: clientId,
    sub: "user_1",
    ...claims,
  });
}

/**
 * Stands in for the two services the auth list talks to. For Upstash's REST
 * endpoint, which the rate limiter calls, it counts requests per address as
 * the limiter's script does inside one window and answers with the script's
 * [remaining, limit]. For Vercel, it answers the issuer's documents.
 */
function stubUpstash() {
  const used = new Map<string, number>();
  const commands: (string | number)[][] = [];
  vi.stubGlobal("fetch", async (input: unknown, init: { body: string }) => {
    const document = vercelDocuments(
      input instanceof Request ? input.url : String(input),
    );
    if (document) return document;
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

function createSession(address = "203.0.113.7", token?: string) {
  return new Request(`${origin}/eve/v1/session`, {
    method: "POST",
    headers: {
      "x-forwarded-for": address,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
}

// What eve's none() returns for every caller it accepts.
const anonymous = {
  attributes: {},
  authenticator: "none",
  principalId: "anonymous",
  principalType: "anonymous",
};

// What agent/lib/vercel-sign-in.ts returns for the token idToken() signs.
const signedIn = {
  authenticator: "vercel-sign-in",
  principalId: "https://vercel.com:user_1",
  principalType: "user",
};

async function rejection(response: unknown) {
  expect(response).toBeInstanceOf(Response);
  return {
    status: (response as Response).status,
    challenge: (response as Response).headers.get("www-authenticate"),
    code: ((await (response as Response).json()) as { code: string }).code,
  };
}

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

  // A deployment that has not set its app's client ID has no sign-in: a
  // token Vercel really issued, to some app, opens nothing.
  describe.each<Setting>([undefined, "false"])(
    "with ALLOW_ANONYMOUS_ACCESS=%s and no VERCEL_APP_CLIENT_ID",
    (setting) => {
      it("does not accept a Sign in with Vercel token", async () => {
        stubUpstash();
        const { auth } = await loadChannel(setting, "production");

        await expect(
          rejection(await routeAuth(createSession(undefined, idToken()), auth)),
        ).resolves.toMatchObject({
          status: 401,
          code: "eve_production_auth_not_configured",
        });
      });
    },
  );

  describe.each<Setting>([undefined, "false"])(
    "with ALLOW_ANONYMOUS_ACCESS=%s and VERCEL_APP_CLIENT_ID set",
    (setting) => {
      it.each<Environment>(["production", "preview"])(
        "accepts a signed-in %s caller as a named user",
        async (environment) => {
          stubUpstash();
          const { auth } = await loadChannel(setting, environment, clientId);

          for (const request of [
            new Request(`${origin}/eve/v1/info`, {
              headers: { authorization: `Bearer ${idToken()}` },
            }),
            createSession(undefined, idToken()),
          ]) {
            await expect(routeAuth(request, auth)).resolves.toMatchObject(
              signedIn,
            );
          }
        },
      );

      it("gives each signed-in user their own identity", async () => {
        stubUpstash();
        const { auth } = await loadChannel(setting, "production", clientId);

        await expect(
          routeAuth(createSession(undefined, idToken({ sub: "user_2" })), auth),
        ).resolves.toMatchObject({ principalId: "https://vercel.com:user_2" });
      });

      // No placeholder is left in the list: this deployment has an auth
      // provider, so eve's "not configured" answer would be wrong.
      it("turns a production caller with no credential away with a plain 401", async () => {
        stubUpstash();
        const { auth } = await loadChannel(setting, "production", clientId);

        for (const request of [
          new Request(`${origin}/eve/v1/info`),
          createSession(),
        ]) {
          await expect(
            rejection(await routeAuth(request, auth)),
          ).resolves.toEqual({
            status: 401,
            challenge: "Bearer",
            code: "unauthorized",
          });
        }
      });

      it.each([
        ["issued to another app", { aud: "cl_another_app" }],
        ["that has expired", { exp: Math.floor(Date.now() / 1000) - 3600 }],
      ])("rejects a token %s", async (_, claims) => {
        stubUpstash();
        const { auth } = await loadChannel(setting, "production", clientId);

        await expect(
          rejection(
            await routeAuth(createSession(undefined, idToken(claims)), auth),
          ),
        ).resolves.toMatchObject({ status: 401, code: "sign_in_not_accepted" });
      });

      it("stays open to the local development server", async () => {
        const { auth } = await loadChannel(setting, "eve dev", clientId);

        await expect(
          routeAuth(new Request(`${origin}/eve/v1/info`), auth),
        ).resolves.toMatchObject({ principalId: "local-dev" });
      });
    },
  );

  describe("with ALLOW_ANONYMOUS_ACCESS=true and VERCEL_APP_CLIENT_ID set", () => {
    it.each<Environment>(["production", "preview"])(
      "accepts a %s caller with no credential as anonymous",
      async (environment) => {
        stubUpstash();
        const { auth } = await loadChannel("true", environment, clientId);

        for (const request of [
          new Request(`${origin}/eve/v1/info`),
          createSession(),
        ]) {
          await expect(routeAuth(request, auth)).resolves.toEqual(anonymous);
        }
      },
    );

    it.each<Environment>(["production", "preview"])(
      "accepts a signed-in %s caller as a named user, not as anonymous",
      async (environment) => {
        stubUpstash();
        const { auth } = await loadChannel("true", environment, clientId);

        await expect(
          routeAuth(createSession(undefined, idToken()), auth),
        ).resolves.toMatchObject(signedIn);
      },
    );

    // The entry that would otherwise catch this caller is none(): an
    // expired sign-in must fail loudly, not continue as an anonymous
    // visitor with someone else's memory key and no tools.
    it.each([
      ["issued to another app", { aud: "cl_another_app" }],
      ["that has expired", { exp: Math.floor(Date.now() / 1000) - 3600 }],
    ])(
      "rejects a token %s rather than admitting it as anonymous",
      async (_, claims) => {
        stubUpstash();
        const { auth } = await loadChannel("true", "production", clientId);

        await expect(
          rejection(
            await routeAuth(createSession(undefined, idToken(claims)), auth),
          ),
        ).resolves.toMatchObject({ status: 401, code: "sign_in_not_accepted" });
      },
    );

    it("holds signed-in callers to the same rate limit", async () => {
      stubUpstash();
      const { auth } = await loadChannel("true", "production", clientId);
      vi.spyOn(winston, "warn").mockImplementation(() => winston as never);

      for (let turn = 1; turn <= 20; turn++) {
        await expect(
          routeAuth(createSession(undefined, idToken()), auth),
        ).resolves.toMatchObject(signedIn);
      }

      await expect(
        rejection(await routeAuth(createSession(undefined, idToken()), auth)),
      ).resolves.toMatchObject({ status: 403 });
    });
  });

  it("fails startup on an empty VERCEL_APP_CLIENT_ID", async () => {
    await expect(loadChannel(undefined, "production", "")).rejects.toThrow(
      /VERCEL_APP_CLIENT_ID/,
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
  // Signing in changes who a caller is, not what is traced: the owner's
  // decision is that a signed-in user's conversations keep full content.
  {
    name: "signed-in Vercel user",
    caller: {
      type: "principal",
      principal: {
        kind: "user",
        authenticator: "vercel-sign-in",
        attributes: {},
      },
    },
    auth: {
      principalType: "user",
      authenticator: "vercel-sign-in",
      attributes: {},
    },
  },
] as const;

describe.each<[Setting, string | undefined]>([
  [undefined, undefined],
  ["true", undefined],
  [undefined, clientId],
  ["true", clientId],
])(
  "eve channel trace audience with ALLOW_ANONYMOUS_ACCESS=%s and VERCEL_APP_CLIENT_ID=%s",
  (setting, appClientId) => {
    it.each(
      ["development", "preview", "production"].flatMap((environment) =>
        callers.map((c) => ({ ...c, environment })),
      ),
    )(
      "classifies $name conversations in $environment as public",
      async ({ caller, auth, environment }) => {
        const { channel } = await loadChannel(
          setting,
          "production",
          appClientId,
        );
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
