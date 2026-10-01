import {
  type AuthFn,
  extractBearerToken,
  UnauthenticatedError,
  verifyOidc,
  withAuthChallenges,
} from "eve/channels/auth";

/** Who signs a Sign in with Vercel ID token: its `iss` claim. */
export const VERCEL_SIGN_IN_ISSUER = "https://vercel.com";

/**
 * The issuer a token claims, read without verifying anything. Only used to
 * tell a token that is meant for this authenticator from one that is not;
 * nothing is trusted on the strength of it.
 */
function claimedIssuer(token: string): unknown {
  try {
    const payload = token.split(".")[1] ?? "";
    return JSON.parse(Buffer.from(payload, "base64url").toString()).iss;
  } catch {
    return undefined;
  }
}

/**
 * Accepts a caller who signed in with Vercel: the bearer token must be an ID
 * token Vercel issued to this deployment's app, which is what the client ID
 * as audience checks. Verification is eve's own verifyOidc(), against the
 * signing keys Vercel publishes.
 *
 * verifyOidc() labels every caller a `service`. A person who signed in is a
 * `user`, which is what gives them their own memory, chat history and
 * user-scoped connections, so the principal type is set here. The principal
 * id is `<issuer>:<Vercel user id>`, stable for one person across sessions.
 *
 * A token from any other issuer is skipped, so the entries after this one
 * still get to judge it. A token that does claim Vercel as its issuer and
 * fails verification is rejected instead: it has expired, or was issued to
 * another app. Skipping it would hand a signed-in caller on to none() on a
 * deployment that allows anonymous access, and their next turn would run as
 * an anonymous visitor without a word.
 *
 * `issuer` exists for tests, which stand in a local issuer for Vercel.
 */
export function vercelSignIn(config: {
  clientId: string;
  issuer?: string;
}): AuthFn<Request> {
  const issuer = config.issuer ?? VERCEL_SIGN_IN_ISSUER;
  return withAuthChallenges(
    async (request) => {
      const token = extractBearerToken(request.headers.get("authorization"));
      if (token === null || claimedIssuer(token) !== issuer) return null;
      const result = await verifyOidc(token, {
        issuer,
        audiences: [config.clientId],
      });
      if (!result.ok) {
        throw new UnauthenticatedError({
          code: "sign_in_not_accepted",
          message:
            "This Sign in with Vercel token was not accepted. It has expired or was issued to another app. Sign in again.",
          challenges: [{ scheme: "Bearer" }],
        });
      }
      return {
        ...result.sessionAuth,
        authenticator: "vercel-sign-in",
        principalType: "user",
      };
    },
    [{ scheme: "Bearer" }],
  );
}
