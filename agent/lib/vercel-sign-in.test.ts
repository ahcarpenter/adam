import { routeAuth } from "eve/channels/auth";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { agentkitUserId } from "./agentkit-user";
import { VERCEL_SIGN_IN_ISSUER, vercelSignIn } from "./vercel-sign-in";
import {
  createSigner,
  issuerDocuments,
  startIssuer,
} from "./vercel-sign-in.fixtures";

// A local server stands in for Vercel: it publishes a discovery document and
// signing keys as Vercel does, and signs the tokens these tests present.
// eve's own verifyOidc() does the verifying, over a real connection.
const clientId = "cl_adam_test";
let vercel: Awaited<ReturnType<typeof startIssuer>>;

beforeAll(async () => {
  vercel = await startIssuer();
});

afterAll(async () => {
  await vercel.close();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function request(authorization?: string) {
  return new Request("https://adam.example/eve/v1/session", {
    method: "POST",
    headers: authorization ? { authorization } : {},
  });
}

function signIn(token: string) {
  const auth = vercelSignIn({ clientId, issuer: vercel.issuer });
  return auth(request(`Bearer ${token}`));
}

async function rejection(token: string) {
  const response = await routeAuth(
    request(`Bearer ${token}`),
    vercelSignIn({ clientId, issuer: vercel.issuer }),
  );
  if (!(response instanceof Response)) {
    throw new Error("the token was accepted");
  }
  return { status: response.status, body: await response.json() };
}

const notAccepted = {
  status: 401,
  body: { code: "sign_in_not_accepted", ok: false },
};

describe("vercelSignIn", () => {
  it("accepts an ID token issued to this app as a named user", async () => {
    const token = vercel.idToken({ aud: clientId, sub: "user_1" });

    await expect(signIn(token)).resolves.toMatchObject({
      authenticator: "vercel-sign-in",
      issuer: vercel.issuer,
      principalId: `${vercel.issuer}:user_1`,
      principalType: "user",
      subject: "user_1",
    });
  });

  it("verifies against Vercel's published issuer by default", async () => {
    // No connection leaves the test: the two documents verifyOidc() fetches
    // from https://vercel.com are answered here.
    const signer = createSigner();
    const documents = issuerDocuments(VERCEL_SIGN_IN_ISSUER, signer);
    const fetched: string[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      fetched.push(url);
      return documents(url) ?? new Response(null, { status: 404 });
    });
    const token = signer.idToken({
      iss: "https://vercel.com",
      aud: clientId,
      sub: "user_1",
    });

    await expect(
      vercelSignIn({ clientId })(request(`Bearer ${token}`)),
    ).resolves.toMatchObject({
      principalId: "https://vercel.com:user_1",
      principalType: "user",
    });
    expect(fetched).toEqual([
      "https://vercel.com/.well-known/openid-configuration",
      "https://vercel.com/.well-known/jwks",
    ]);
  });

  describe("skips, leaving the caller to the entries after it", () => {
    it("a request with no credential", async () => {
      const auth = vercelSignIn({ clientId, issuer: vercel.issuer });

      await expect(auth(request())).resolves.toBeNull();
    });

    it("a credential that is not a bearer token", async () => {
      const auth = vercelSignIn({ clientId, issuer: vercel.issuer });

      await expect(auth(request("Basic dXNlcjpwYXNz"))).resolves.toBeNull();
    });

    it.each([
      ["with no payload", "opaque-api-key"],
      ["whose payload is not JSON", "header.not-json.signature"],
    ])("a bearer token %s", async (_, token) => {
      await expect(signIn(token)).resolves.toBeNull();
    });

    // The project's own Vercel OIDC token is one of these: vercelOidc()
    // comes first in the channel's list, and a token it turns down must not
    // be rejected here on its way to the entries below.
    it("a token from another issuer, even one signed by this key", async () => {
      const token = vercel.idToken({
        iss: "https://oidc.vercel.com/team",
        aud: clientId,
        sub: "user_1",
      });

      await expect(signIn(token)).resolves.toBeNull();
    });
  });

  // Skipping these would pass a caller who meant to sign in on to none() on
  // a deployment that allows anonymous access, as an anonymous visitor.
  describe("rejects a token that claims Vercel as its issuer and fails", () => {
    it("because it was issued to another app", async () => {
      const token = vercel.idToken({ aud: "cl_another_app", sub: "user_1" });

      await expect(rejection(token)).resolves.toMatchObject(notAccepted);
    });

    it("because it has expired", async () => {
      const token = vercel.idToken({
        aud: clientId,
        sub: "user_1",
        exp: Math.floor(Date.now() / 1000) - 3600,
      });

      await expect(rejection(token)).resolves.toMatchObject(notAccepted);
    });

    it("because Vercel did not sign it", async () => {
      const token = vercel.forgedIdToken({ aud: clientId, sub: "user_1" });

      await expect(rejection(token)).resolves.toMatchObject(notAccepted);
    });

    it("because it names no user", async () => {
      const token = vercel.idToken({ aud: clientId });

      await expect(rejection(token)).resolves.toMatchObject(notAccepted);
    });
  });

  it("asks for a bearer token when nothing in the list accepts the caller", async () => {
    const response = await routeAuth(
      request(),
      vercelSignIn({ clientId, issuer: vercel.issuer }),
    );

    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(401);
    expect((response as Response).headers.get("www-authenticate")).toBe(
      "Bearer",
    );
  });

  // AgentKit keys memory and chat history by agentkitUserId(), so this is
  // what decides whether two signed-in people share them.
  describe("memory and chat history", () => {
    async function userIdOf(sub: string, sessionId: string) {
      const caller = await signIn(vercel.idToken({ aud: clientId, sub }));
      if (!caller) throw new Error("the token was not accepted");
      return agentkitUserId({
        session: {
          id: sessionId,
          auth: { current: caller, initiator: caller },
        },
      });
    }

    it("are keyed by each signed-in user's own Vercel user id", async () => {
      const first = await userIdOf("user_1", "session-a");
      const second = await userIdOf("user_2", "session-b");

      expect(first).toBe(`${vercel.issuer}:user_1`);
      expect(second).toBe(`${vercel.issuer}:user_2`);
    });

    it("follow one signed-in user from session to session", async () => {
      expect(await userIdOf("user_1", "session-a")).toBe(
        await userIdOf("user_1", "session-b"),
      );
    });
  });
});
