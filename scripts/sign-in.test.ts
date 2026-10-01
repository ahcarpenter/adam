import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Dependencies, run, VERCEL_SIGN_IN } from "./sign-in";

// A local server stands in for Vercel's token endpoint, and a function
// stands in for the browser: handed the authorize URL, it does what Vercel's
// consent page does on approval and requests the callback. The helper itself
// runs for real: its listener, its PKCE values, its token request.

const clientId = "cl_adam_test";
const agentUrl = "https://adam.example";

const encode = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

/** An unsigned ID token: the helper reads its claims and verifies nothing. */
function idTokenWith(claims: Record<string, unknown>) {
  return `${encode({ alg: "RS256" })}.${encode(claims)}.signature`;
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}

async function freePort(): Promise<number> {
  const probe = createServer();
  const port = await listen(probe);
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

/** What the fake Vercel saw and what the helper did, for one test. */
interface Sandbox {
  deps: Dependencies;
  log: string[];
  /** The authorize URLs handed to the browser. */
  authorized: URL[];
  /** The form bodies posted to the token endpoint. */
  tokenRequests: URLSearchParams[];
  /** Calls to eve's client, as [url, idToken]. */
  connected: [string, string][];
  /** What the callback page showed the browser. */
  pages: { status: number; text: string }[];
  /** Replaces what the token endpoint answers. */
  tokenAnswer: (
    form: URLSearchParams,
    nonce: string,
  ) => { status: number; body: unknown };
  /** Replaces what the browser does with the authorize URL. */
  browser: (authorize: URL) => Promise<void> | void;
  /** Settles when the browser has finished what it was doing. */
  browsed: Promise<void>;
  visit: (url: string) => Promise<void>;
}

let tokenServer: Server;
let sandbox: Sandbox;

beforeEach(async () => {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  let nonce = "";
  const made: Sandbox = {
    log: [],
    authorized: [],
    tokenRequests: [],
    connected: [],
    pages: [],
    tokenAnswer: (_form, issuedNonce) => ({
      status: 200,
      body: {
        id_token: idTokenWith({ sub: "user_1", nonce: issuedNonce, exp }),
        access_token: "opaque",
      },
    }),
    // Vercel's consent page, approved: back to the callback with a code.
    browser: (authorize) =>
      made.visit(
        `${authorize.searchParams.get("redirect_uri")}?code=granted-code&state=${authorize.searchParams.get("state")}`,
      ),
    visit: async (url) => {
      const response = await fetch(url);
      made.pages.push({ status: response.status, text: await response.text() });
    },
    browsed: Promise.resolve(),
    deps: undefined as never,
  };

  tokenServer = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const form = new URLSearchParams(body);
      made.tokenRequests.push(form);
      const answer = made.tokenAnswer(form, nonce);
      response.writeHead(answer.status, { "content-type": "application/json" });
      response.end(
        typeof answer.body === "string"
          ? answer.body
          : JSON.stringify(answer.body),
      );
    });
  });

  made.deps = {
    env: {},
    port: await freePort(),
    authorizeEndpoint: "https://vercel.test/oauth/authorize",
    tokenEndpoint: `http://127.0.0.1:${await listen(tokenServer)}/login/oauth/token`,
    timeoutMs: 10_000,
    log: (line) => made.log.push(line),
    open: (url) => {
      const authorize = new URL(url);
      made.authorized.push(authorize);
      nonce = authorize.searchParams.get("nonce") ?? "";
      made.browsed = Promise.resolve(made.browser(authorize));
    },
    connect: async (url, idToken) => {
      made.connected.push([url, idToken]);
      return 0;
    },
  };
  sandbox = made;
});

afterEach(async () => {
  await new Promise<void>((resolve) => tokenServer.close(() => resolve()));
});

/** Runs the command, and lets the browser finish receiving its last page. */
async function signInWith(...args: string[]) {
  const exitCode = await run(args, sandbox.deps);
  await sandbox.browsed;
  return exitCode;
}

describe("pnpm connect", () => {
  it("signs in through the browser and opens eve's client with the ID token", async () => {
    await expect(signInWith(agentUrl, "--client-id", clientId)).resolves.toBe(
      0,
    );

    expect(sandbox.connected).toHaveLength(1);
    const [url, idToken] = sandbox.connected[0] as [string, string];
    expect(url).toBe(agentUrl);
    expect(JSON.parse(atob(idToken.split(".")[1] as string))).toMatchObject({
      sub: "user_1",
    });
    expect(sandbox.pages).toEqual([
      { status: 200, text: expect.stringContaining("Signed in.") },
    ]);
  });

  it.each([
    "https://adam.example",
    "https://192.168.1.20:3000",
    "http://localhost:3000",
    "http://LOCALHOST:3000",
    "http://127.0.0.1:3000",
    "http://[::1]:3000",
    "http://localhost",
  ])(
    "accepts %s: https anywhere, plain http on this machine only",
    async (url) => {
      await expect(signInWith(url, "--client-id", clientId)).resolves.toBe(0);

      expect(sandbox.authorized).toHaveLength(1);
      expect(sandbox.connected).toEqual([[url, expect.any(String)]]);
    },
  );

  it("returns the exit code of eve's client", async () => {
    sandbox.deps.connect = async () => 7;

    await expect(signInWith(agentUrl, "--client-id", clientId)).resolves.toBe(
      7,
    );
  });

  it("takes the client ID from VERCEL_APP_CLIENT_ID when no flag is given", async () => {
    sandbox.deps.env = { VERCEL_APP_CLIENT_ID: "cl_from_env" };

    await signInWith(agentUrl);

    expect(sandbox.authorized[0]?.searchParams.get("client_id")).toBe(
      "cl_from_env",
    );
  });

  it("prefers the flag to the environment", async () => {
    sandbox.deps.env = { VERCEL_APP_CLIENT_ID: "cl_from_env" };

    await signInWith(agentUrl, "--client-id", clientId);

    expect(sandbox.authorized[0]?.searchParams.get("client_id")).toBe(clientId);
  });

  it("asks Vercel for an authorization code with PKCE and an ID token", async () => {
    await signInWith(agentUrl, "--client-id", clientId);

    const [authorize] = sandbox.authorized as [URL];
    expect(`${authorize.origin}${authorize.pathname}`).toBe(
      sandbox.deps.authorizeEndpoint,
    );
    expect(Object.fromEntries(authorize.searchParams)).toEqual({
      client_id: clientId,
      redirect_uri: `http://127.0.0.1:${sandbox.deps.port}/callback`,
      response_type: "code",
      scope: "openid",
      state: expect.stringMatching(/^[\w-]{43}$/),
      nonce: expect.stringMatching(/^[\w-]{43}$/),
      code_challenge: expect.stringMatching(/^[\w-]{43}$/),
      code_challenge_method: "S256",
    });
  });

  it("exchanges the code as a public client, proving itself with the PKCE verifier", async () => {
    await signInWith(agentUrl, "--client-id", clientId);

    const [authorize] = sandbox.authorized as [URL];
    const [form] = sandbox.tokenRequests as [URLSearchParams];
    const { code_verifier: verifier, ...rest } = Object.fromEntries(form);
    expect(rest).toEqual({
      grant_type: "authorization_code",
      client_id: clientId,
      code: "granted-code",
      redirect_uri: `http://127.0.0.1:${sandbox.deps.port}/callback`,
    });
    // No secret is sent: there is none. The verifier is what Vercel checks
    // against the challenge the authorize request carried.
    expect(form.has("client_secret")).toBe(false);
    expect(
      createHash("sha256")
        .update(verifier as string)
        .digest("base64url"),
    ).toBe(authorize.searchParams.get("code_challenge"));
  });

  it("uses fresh state, nonce and verifier for every sign-in", async () => {
    await signInWith(agentUrl, "--client-id", clientId);
    await signInWith(agentUrl, "--client-id", clientId);

    const [first, second] = sandbox.authorized as [URL, URL];
    for (const name of ["state", "nonce", "code_challenge"]) {
      expect(first.searchParams.get(name)).not.toBe(
        second.searchParams.get(name),
      );
    }
  });

  it("says how long the sign-in lasts, and never prints the token", async () => {
    await signInWith(agentUrl, "--client-id", clientId);

    const [, idToken] = sandbox.connected[0] as [string, string];
    const printed = sandbox.log.join("\n");
    expect(printed).toContain("The sign-in lasts until");
    expect(printed).not.toContain(idToken);
    expect(printed).not.toContain("granted-code");
  });

  it("prints the sign-in address for a browser that does not open", async () => {
    await signInWith(agentUrl, "--client-id", clientId);

    expect(sandbox.log[0]).toContain(String(sandbox.authorized[0]));
  });

  it("stops listening once it is done", async () => {
    await signInWith(agentUrl, "--client-id", clientId);

    await expect(
      fetch(`http://127.0.0.1:${sandbox.deps.port}/callback`),
    ).rejects.toThrow();
  });

  describe("refuses to start", () => {
    it.each([
      ["no agent URL", []],
      ["two agent URLs", [agentUrl, "https://other.example"]],
      ["a flag it does not know", [agentUrl, "--port", "1234"]],
      ["--client-id with no value", [agentUrl, "--client-id"]],
    ])("given %s, with the usage", async (_, args) => {
      await expect(signInWith(...args)).resolves.toBe(1);

      expect(sandbox.log.join("\n")).toContain("Usage: pnpm connect <url>");
      expect(sandbox.authorized).toEqual([]);
      expect(sandbox.connected).toEqual([]);
    });

    it.each(["adam.example", "ftp://adam.example"])(
      "given %s, which is not an http or https URL",
      async (url) => {
        await expect(signInWith(url, "--client-id", clientId)).resolves.toBe(1);

        expect(sandbox.log.join("\n")).toContain(
          `Not an http or https URL: ${url}`,
        );
        expect(sandbox.authorized).toEqual([]);
      },
    );

    // The ID token is a bearer credential: over plain http it would cross
    // the network in clear text.
    it.each([
      "http://adam.example",
      "http://adam.example:8080/path",
      "HTTP://adam.example",
      "http://192.168.1.20:3000",
      "http://127.0.0.2:3000",
      "http://localhost.adam.example",
      "http://127.0.0.1.adam.example",
      "http://localhost@adam.example",
      "http://[::2]:3000",
    ])(
      "given %s, plain http to another machine, saying why and what to use",
      async (url) => {
        await expect(signInWith(url, "--client-id", clientId)).resolves.toBe(1);

        const printed = sandbox.log.join("\n");
        expect(printed).toContain(`Refusing to sign in to ${url}`);
        expect(printed).toContain("unencrypted");
        expect(printed).toContain("https");
        expect(printed).toContain("localhost, 127.0.0.1 or [::1]");
        expect(sandbox.authorized).toEqual([]);
        expect(sandbox.connected).toEqual([]);
        await expect(
          fetch(`http://127.0.0.1:${sandbox.deps.port}/callback`),
        ).rejects.toThrow();
      },
    );

    it("with no client ID, naming both ways to give one", async () => {
      await expect(signInWith(agentUrl)).resolves.toBe(1);

      const printed = sandbox.log.join("\n");
      expect(printed).toContain("--client-id");
      expect(printed).toContain("VERCEL_APP_CLIENT_ID");
      expect(sandbox.authorized).toEqual([]);
    });

    // The app registers one callback URL, so no other port will do.
    it("when the callback port is taken, naming the port", async () => {
      const squatter = createServer();
      await new Promise<void>((resolve) =>
        squatter.listen(sandbox.deps.port, "127.0.0.1", resolve),
      );
      try {
        await expect(
          signInWith(agentUrl, "--client-id", clientId),
        ).resolves.toBe(1);

        expect(sandbox.log.join("\n")).toContain(
          `Port ${sandbox.deps.port} is in use.`,
        );
        expect(sandbox.authorized).toEqual([]);
        expect(sandbox.connected).toEqual([]);
      } finally {
        await new Promise<void>((resolve) => squatter.close(() => resolve()));
      }
    });
  });

  describe("the callback", () => {
    // Anything on this machine can request the port. Only the redirect
    // carrying this run's state counts.
    it("ignores a request with the wrong state, and still takes the real redirect", async () => {
      sandbox.browser = async (authorize) => {
        const callback = authorize.searchParams.get("redirect_uri");
        await sandbox.visit(`${callback}?code=injected-code&state=guessed`);
        await sandbox.visit(`${callback}?code=injected-code`);
        await sandbox.visit(
          `${callback}?code=granted-code&state=${authorize.searchParams.get("state")}`,
        );
      };

      await expect(signInWith(agentUrl, "--client-id", clientId)).resolves.toBe(
        0,
      );

      expect(sandbox.pages.map((page) => page.status)).toEqual([400, 400, 200]);
      expect(sandbox.tokenRequests.map((form) => form.get("code"))).toEqual([
        "granted-code",
      ]);
    });

    it("answers 404 anywhere else and keeps waiting", async () => {
      sandbox.browser = async (authorize) => {
        const callback = String(authorize.searchParams.get("redirect_uri"));
        await sandbox.visit(callback.replace("/callback", "/favicon.ico"));
        await sandbox.visit(
          `${callback}?code=granted-code&state=${authorize.searchParams.get("state")}`,
        );
      };

      await expect(signInWith(agentUrl, "--client-id", clientId)).resolves.toBe(
        0,
      );

      expect(sandbox.pages.map((page) => page.status)).toEqual([404, 200]);
    });

    it("reports a sign-in the person or Vercel refused", async () => {
      sandbox.browser = (authorize) =>
        sandbox.visit(
          `${authorize.searchParams.get("redirect_uri")}?error=access_denied&error_description=The+user+denied+the+request&state=${authorize.searchParams.get("state")}`,
        );

      await expect(signInWith(agentUrl, "--client-id", clientId)).resolves.toBe(
        1,
      );

      expect(sandbox.log.join("\n")).toContain(
        "Vercel did not sign you in: The user denied the request",
      );
      expect(sandbox.pages[0]?.status).toBe(400);
      expect(sandbox.tokenRequests).toEqual([]);
      expect(sandbox.connected).toEqual([]);
    });

    it.each([
      ["an error with no description", "error=server_error", "server_error"],
      ["neither a code nor an error", "", "no code"],
    ])("reports a redirect carrying %s", async (_, query, reason) => {
      sandbox.browser = (authorize) =>
        sandbox.visit(
          `${authorize.searchParams.get("redirect_uri")}?${query}&state=${authorize.searchParams.get("state")}`,
        );

      await expect(signInWith(agentUrl, "--client-id", clientId)).resolves.toBe(
        1,
      );

      expect(sandbox.log.join("\n")).toContain(
        `Vercel did not sign you in: ${reason}`,
      );
    });

    it("gives up when nobody finishes signing in", async () => {
      sandbox.deps.timeoutMs = 50;
      sandbox.browser = () => {};

      await expect(signInWith(agentUrl, "--client-id", clientId)).resolves.toBe(
        1,
      );

      expect(sandbox.log.join("\n")).toContain("Timed out waiting");
      expect(sandbox.connected).toEqual([]);
    });
  });

  describe("the token exchange", () => {
    it("reports why Vercel refused it", async () => {
      sandbox.tokenAnswer = () => ({
        status: 400,
        body: {
          error: "invalid_grant",
          error_description: "Invalid authorization code.",
        },
      });

      await expect(signInWith(agentUrl, "--client-id", clientId)).resolves.toBe(
        1,
      );

      expect(sandbox.log.join("\n")).toContain(
        "Vercel refused the sign-in (400): Invalid authorization code.",
      );
      expect(sandbox.connected).toEqual([]);
    });

    it.each([
      ["only an error code", { error: "invalid_client" }, "invalid_client"],
      ["a body that is not JSON", "<html>bad gateway</html>", "no reason"],
    ])("reports a refusal with %s", async (_, body, reason) => {
      sandbox.tokenAnswer = () => ({ status: 502, body });

      await expect(signInWith(agentUrl, "--client-id", clientId)).resolves.toBe(
        1,
      );

      expect(sandbox.log.join("\n")).toContain(
        `Vercel refused the sign-in (502): ${reason}`,
      );
    });

    // What an app without the openid scope gets back.
    it("stops when Vercel returns no ID token", async () => {
      sandbox.tokenAnswer = () => ({
        status: 200,
        body: { access_token: "opaque" },
      });

      await expect(signInWith(agentUrl, "--client-id", clientId)).resolves.toBe(
        1,
      );

      expect(sandbox.log.join("\n")).toContain("Vercel returned no ID token");
      expect(sandbox.connected).toEqual([]);
    });

    it("stops when the ID token answers a different sign-in request", async () => {
      sandbox.tokenAnswer = () => ({
        status: 200,
        body: { id_token: idTokenWith({ sub: "user_1", nonce: "another" }) },
      });

      await expect(signInWith(agentUrl, "--client-id", clientId)).resolves.toBe(
        1,
      );

      expect(sandbox.log.join("\n")).toContain("a different sign-in request");
      expect(sandbox.connected).toEqual([]);
    });

    it("stops when Vercel cannot be reached", async () => {
      sandbox.deps.tokenEndpoint = `http://127.0.0.1:${await freePort()}/token`;

      await expect(signInWith(agentUrl, "--client-id", clientId)).resolves.toBe(
        1,
      );

      expect(sandbox.log.join("\n")).toContain("Could not reach Vercel");
      expect(sandbox.connected).toEqual([]);
    });

    // The browser is answered only when the outcome is known, so its page
    // never says "Signed in" for a sign-in the terminal reports as failed.
    it("tells the browser the sign-in failed, not that it worked", async () => {
      sandbox.tokenAnswer = () => ({
        status: 400,
        body: { error: "invalid_grant" },
      });

      await signInWith(agentUrl, "--client-id", clientId);

      expect(sandbox.pages).toEqual([
        { status: 400, text: expect.stringContaining("Sign-in failed.") },
      ]);
    });

    it("stops when the ID token cannot be read", async () => {
      sandbox.tokenAnswer = () => ({
        status: 200,
        body: { id_token: "not-a-jwt" },
      });

      await expect(signInWith(agentUrl, "--client-id", clientId)).resolves.toBe(
        1,
      );

      expect(sandbox.log.join("\n")).toContain("cannot be read");
      expect(sandbox.connected).toEqual([]);
    });

    it("connects without an expiry line when the token carries none", async () => {
      sandbox.tokenAnswer = (_form, nonce) => ({
        status: 200,
        body: { id_token: idTokenWith({ sub: "user_1", nonce }) },
      });

      await expect(signInWith(agentUrl, "--client-id", clientId)).resolves.toBe(
        0,
      );

      expect(sandbox.log.join("\n")).not.toContain("The sign-in lasts until");
    });
  });

  it("lets a failure that is not the person's to fix surface as it is", async () => {
    sandbox.deps.connect = async () => {
      throw new Error("eve is not installed");
    };

    await expect(signInWith(agentUrl, "--client-id", clientId)).rejects.toThrow(
      "eve is not installed",
    );
  });
});

// The values the docs tell a fork to register on its app and the endpoints
// Vercel documents. Changing one here without the docs breaks sign-in.
describe("what a real sign-in runs against", () => {
  it("is Vercel's endpoints and the callback port the docs register", () => {
    expect(VERCEL_SIGN_IN).toEqual({
      authorizeEndpoint: "https://vercel.com/oauth/authorize",
      tokenEndpoint: "https://api.vercel.com/login/oauth/token",
      port: 53682,
      timeoutMs: 300_000,
    });
  });
});
