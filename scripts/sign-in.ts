import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";

// The terminal half of Sign in with Vercel: signs a person in through their
// browser and opens eve's terminal client on a deployed agent as that
// person. eve's client has no sign-in of its own. It can only send a header
// it is given, so this gets the token and hands it over.
//
// The flow is the authorization code grant with PKCE, as a public client:
// no client secret exists, here or anywhere. Vercel does not offer the
// device grant to Sign in with Vercel apps, which is why this needs a
// browser on the same machine, and a callback on a fixed local port that
// the app has registered. Read "Sign-in" in docs/configuration.md.

/** What a real sign-in runs against. Tests stand in their own. */
export const VERCEL_SIGN_IN = {
  authorizeEndpoint: "https://vercel.com/oauth/authorize",
  tokenEndpoint: "https://api.vercel.com/login/oauth/token",
  /**
   * The port Vercel sends the browser back to. The app registers the exact
   * callback URL, http://127.0.0.1:53682/callback, so the port is fixed:
   * changing it here means changing it on the app too.
   */
  port: 53682,
  /** How long a person has to finish signing in, in milliseconds. */
  timeoutMs: 5 * 60 * 1000,
};

const USAGE = `Usage: pnpm connect <url> [--client-id <id>]

Signs you in with Vercel in your browser, then opens the eve terminal client
on the agent at <url> as you.

  <url>               The deployed agent, for example https://adam.example.
                      Plain http is accepted only for an agent on this
                      machine: localhost, 127.0.0.1 or [::1].
  --client-id <id>    Client ID of the agent's Sign in with Vercel app.
                      Defaults to VERCEL_APP_CLIENT_ID, which is also read
                      from .env.local.`;

export interface Dependencies {
  env: Record<string, string | undefined>;
  /** Opens a URL in the person's browser. */
  open: (url: string) => void;
  /** Starts eve's terminal client and resolves with its exit code. */
  connect: (url: string, idToken: string) => Promise<number>;
  log: (line: string) => void;
  port: number;
  authorizeEndpoint: string;
  tokenEndpoint: string;
  timeoutMs: number;
}

/** A failure the person can act on: printed as is, without a stack. */
class SignInError extends Error {}

/** The hosts plain http is accepted for, as `URL` spells their hostname. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

const base64url = (bytes: Buffer) => bytes.toString("base64url");

function parseArguments(args: readonly string[], env: Dependencies["env"]) {
  let url: string | undefined;
  let clientId = env.VERCEL_APP_CLIENT_ID;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] as string;
    if (arg === "--client-id") {
      clientId = args[++index];
      if (!clientId) throw new SignInError(USAGE);
    } else if (arg.startsWith("-") || url !== undefined) {
      throw new SignInError(USAGE);
    } else {
      url = arg;
    }
  }
  if (url === undefined) throw new SignInError(USAGE);
  if (!URL.canParse(url) || !/^https?:$/.test(new URL(url).protocol)) {
    throw new SignInError(`Not an http or https URL: ${url}\n\n${USAGE}`);
  }
  const { protocol, hostname } = new URL(url);
  if (protocol === "http:" && !LOOPBACK_HOSTS.has(hostname)) {
    throw new SignInError(
      `Refusing to sign in to ${url}: over plain http the sign-in token would cross the network unencrypted, where anyone on the path could read it and use the agent as you. Use the agent's https address. Plain http is accepted only for an agent on this machine: localhost, 127.0.0.1 or [::1].`,
    );
  }
  if (!clientId) {
    throw new SignInError(
      `No client ID. Pass --client-id, or set VERCEL_APP_CLIENT_ID to the client ID of the agent's Sign in with Vercel app.\n\n${USAGE}`,
    );
  }
  return { url, clientId };
}

/** Vercel's redirect, with the browser still waiting for its page. */
interface Redirect {
  code: string;
  /** Writes the page the browser shows, once the outcome is known. */
  answer: (status: number, text: string) => Promise<void>;
}

/**
 * Listens on the callback port for Vercel's redirect and resolves with the
 * authorization code it carries. Only a redirect whose `state` is the one
 * this run generated is taken; anything else is answered and ignored, so a
 * stray request to the port cannot end the sign-in or inject a code.
 */
async function listenForCallback(input: {
  port: number;
  state: string;
  timeoutMs: number;
}): Promise<{ redirect: Promise<Redirect>; close: () => Promise<void> }> {
  let settle: (outcome: Redirect | Error) => void;
  const redirect = new Promise<Redirect>((resolve, reject) => {
    settle = (outcome) =>
      outcome instanceof Error ? reject(outcome) : resolve(outcome);
  });
  // The promise is awaited by the caller after the browser opens; a
  // rejection before that must not count as unhandled.
  redirect.catch(() => {});

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${input.port}`);
    const answer = (status: number, text: string) =>
      new Promise<void>((written) => {
        response.writeHead(status, {
          "content-type": "text/plain; charset=utf-8",
          connection: "close",
        });
        response.end(`${text}\n`, written);
      });
    if (url.pathname !== "/callback") return answer(404, "Not found.");
    if (url.searchParams.get("state") !== input.state) {
      return answer(400, "This sign-in was not started from your terminal.");
    }
    const error = url.searchParams.get("error");
    const code = url.searchParams.get("code");
    if (error || !code) {
      const reason =
        url.searchParams.get("error_description") ?? error ?? "no code";
      // Settled only once the page is written: settling closes the listener.
      return answer(
        400,
        `Sign-in failed: ${reason}. Return to the terminal.`,
      ).then(() =>
        settle(new SignInError(`Vercel did not sign you in: ${reason}`)),
      );
    }
    // The browser is left waiting: whether this is a sign-in is not known
    // until the code has been exchanged.
    settle({ code, answer });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", (error: NodeJS.ErrnoException) => {
      reject(
        error.code === "EADDRINUSE"
          ? new SignInError(
              `Port ${input.port} is in use. Signing in needs that port for Vercel's callback, and the app allows no other. Close whatever is listening on it and run this again.`,
            )
          : error,
      );
    });
    // Loopback only: the callback must never be reachable from the network.
    server.listen(input.port, "127.0.0.1", resolve);
  });

  const timer = setTimeout(() => {
    settle(
      new SignInError(
        "Timed out waiting for the sign-in to finish in the browser.",
      ),
    );
  }, input.timeoutMs);

  return {
    redirect,
    close: () => {
      clearTimeout(timer);
      return new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  };
}

/** The claims of an ID token, read without verifying it. */
function claimsOf(idToken: string): Record<string, unknown> {
  try {
    const payload = idToken.split(".")[1] ?? "";
    return JSON.parse(Buffer.from(payload, "base64url").toString());
  } catch {
    throw new SignInError("Vercel returned an ID token that cannot be read.");
  }
}

async function exchangeCode(input: {
  tokenEndpoint: string;
  clientId: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
  timeoutMs: number;
}): Promise<string> {
  // No client_secret: the app is a public client, and PKCE proves this is
  // the process that started the sign-in.
  const response = await fetch(input.tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: input.clientId,
      code: input.code,
      code_verifier: input.codeVerifier,
      redirect_uri: input.redirectUri,
    }),
    signal: AbortSignal.timeout(input.timeoutMs),
  }).catch((error: unknown) => {
    throw new SignInError(`Could not reach Vercel: ${String(error)}`);
  });
  const body = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok) {
    throw new SignInError(
      `Vercel refused the sign-in (${response.status}): ${String(body.error_description ?? body.error ?? "no reason given")}`,
    );
  }
  if (typeof body.id_token !== "string") {
    throw new SignInError(
      "Vercel returned no ID token. The app needs the openid scope.",
    );
  }
  return body.id_token;
}

/**
 * Signs a person in with Vercel through their browser and returns the ID
 * token Vercel issued to the app. The token is the credential: it is never
 * logged.
 */
async function signIn(
  clientId: string,
  deps: Pick<
    Dependencies,
    | "open"
    | "log"
    | "port"
    | "authorizeEndpoint"
    | "tokenEndpoint"
    | "timeoutMs"
  >,
): Promise<string> {
  const redirectUri = `http://127.0.0.1:${deps.port}/callback`;
  const state = base64url(randomBytes(32));
  const nonce = base64url(randomBytes(32));
  const codeVerifier = base64url(randomBytes(32));

  const callback = await listenForCallback({
    port: deps.port,
    state,
    timeoutMs: deps.timeoutMs,
  });
  try {
    const authorize = new URL(deps.authorizeEndpoint);
    authorize.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid",
      state,
      nonce,
      code_challenge: base64url(
        createHash("sha256").update(codeVerifier).digest(),
      ),
      code_challenge_method: "S256",
    }).toString();

    deps.log(
      `Opening your browser to sign in with Vercel. If it does not open, visit:\n\n  ${authorize}\n`,
    );
    deps.open(authorize.toString());

    const redirect = await callback.redirect;
    try {
      const idToken = await exchangeCode({
        tokenEndpoint: deps.tokenEndpoint,
        clientId,
        code: redirect.code,
        codeVerifier,
        redirectUri,
        timeoutMs: deps.timeoutMs,
      });
      const claims = claimsOf(idToken);
      // The token came straight from Vercel over TLS, so its signature is
      // the agent's to verify. The nonce ties it to this run's request.
      if (claims.nonce !== nonce) {
        throw new SignInError(
          "Vercel returned an ID token for a different sign-in request.",
        );
      }
      await redirect.answer(
        200,
        "Signed in. You can close this tab and return to the terminal.",
      );
      if (typeof claims.exp === "number") {
        deps.log(
          `Signed in. The sign-in lasts until ${new Date(claims.exp * 1000).toLocaleTimeString()}; after that the agent answers 401 and you run this again.`,
        );
      }
      return idToken;
    } catch (error) {
      await redirect.answer(
        400,
        "Sign-in failed. Return to the terminal for the reason.",
      );
      throw error;
    }
  } finally {
    await callback.close();
  }
}

/** Runs the command and resolves with the process exit code. */
export async function run(
  args: readonly string[],
  deps: Dependencies,
): Promise<number> {
  try {
    const { url, clientId } = parseArguments(args, deps.env);
    const idToken = await signIn(clientId, deps);
    return await deps.connect(url, idToken);
  } catch (error) {
    if (!(error instanceof SignInError)) throw error;
    deps.log(error.message);
    return 1;
  }
}
