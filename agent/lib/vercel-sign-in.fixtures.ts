import { generateKeyPairSync, type KeyObject, sign } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

const encode = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

/**
 * A signing key standing in for Vercel's, for tests that need ID tokens eve
 * will verify. No real key or token is involved: the pair is generated here
 * and lives only for the test run.
 */
export function createSigner() {
  const generate = () => generateKeyPairSync("rsa", { modulusLength: 2048 });
  const { publicKey, privateKey } = generate();
  const kid = "test-key";

  const signWith = (key: KeyObject, claims: Record<string, unknown>) => {
    const now = Math.floor(Date.now() / 1000);
    const body = `${encode({ alg: "RS256", kid, typ: "JWT" })}.${encode({
      iat: now,
      exp: now + 3600,
      ...claims,
    })}`;
    const signature = sign("sha256", Buffer.from(body), key);
    return `${body}.${signature.toString("base64url")}`;
  };

  return {
    /** What the issuer publishes at its `jwks_uri`. */
    jwks: {
      keys: [{ ...publicKey.export({ format: "jwk" }), kid, alg: "RS256" }],
    },
    /** An ID token signed by the issuer, valid for an hour unless told otherwise. */
    idToken: (claims: Record<string, unknown>) => signWith(privateKey, claims),
    /** The same token signed by a key the issuer never published. */
    forgedIdToken: (claims: Record<string, unknown>) =>
      signWith(generate().privateKey, claims),
  };
}

type Signer = ReturnType<typeof createSigner>;

/**
 * The two documents eve's verifyOidc() fetches from an issuer, as a `fetch`
 * for the issuer's own URLs. Returns `undefined` for any other URL so a test
 * can chain it ahead of another stub.
 */
export function issuerDocuments(issuer: string, signer: Signer) {
  return (url: string): Response | undefined => {
    if (url === `${issuer}/.well-known/openid-configuration`) {
      return Response.json({ issuer, jwks_uri: `${issuer}/.well-known/jwks` });
    }
    if (url === `${issuer}/.well-known/jwks`) {
      return Response.json(signer.jwks);
    }
    return undefined;
  };
}

/**
 * A local HTTP server standing in for an OpenID Connect issuer, for tests
 * that verify tokens over a real connection.
 */
export async function startIssuer() {
  const signer = createSigner();
  let documents: ReturnType<typeof issuerDocuments> = () => undefined;
  const server = createServer(async (request, response) => {
    const found = documents(`${issuer}${request.url}`);
    response.writeHead(found?.status ?? 404, {
      "content-type": "application/json",
    });
    response.end(found ? await found.text() : "{}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  documents = issuerDocuments(issuer, signer);

  return {
    issuer,
    idToken: (claims: Record<string, unknown>) =>
      signer.idToken({ iss: issuer, ...claims }),
    forgedIdToken: (claims: Record<string, unknown>) =>
      signer.forgedIdToken({ iss: issuer, ...claims }),
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
