# ADR-003: Use Sign in with Vercel as the sign-in provider

## Status

Accepted

## Date

2026-10-01

## Context

Open access ([ADR-002](002-opt-in-anonymous-access.md)) admits callers without an
identity; adam also needed a real sign-in so a caller can have their own memory. eve's
terminal client, `eve remote connect`, has no sign-in step of its own: it can send a
fixed header, a username and password, or a Vercel CLI session belonging to the
project's own team. So any provider needs a small helper that signs the visitor in and
hands the token to the client.

## Decision

Use [Sign in with Vercel](https://vercel.com/docs/sign-in-with-vercel). A deployment
sets the optional `VERCEL_APP_CLIENT_ID`, and `agent/lib/vercel-sign-in.ts` verifies
the caller's ID token with eve's own `verifyOidc()`, issuer `https://vercel.com`,
audience the client ID. `pnpm connect` signs the visitor in through a browser redirect
with PKCE and a localhost callback, then starts the terminal client with the token.
Vercel's device sign-in was the first choice for the helper, but Vercel refuses the
device grant for apps a team registers, so the documented redirect flow is used.

Three smaller calls serve this decision:

- adam's own production app admits anyone with a Vercel account, not only its team.
- On a deployment open to anonymous callers, a signed-in caller gets the sandbox shell,
  file and web-fetch tools back, decided per caller on every turn. The alternatives
  were identity and memory only, or tools for team members only; this one accepts that
  anyone with a free Vercel account can run commands in the sandbox and spend the model
  budget.
- A signed-in user's conversations are traced in full, like every other conversation.

Shipped in https://github.com/ahcarpenter/adam/pull/48; a real sign-in on 2026-10-01
proved the flow end to end (https://github.com/ahcarpenter/adam/pull/53).

## Alternatives Considered

### Clerk

- Pros: native in the Vercel Marketplace; works for any audience.
- Rejected: a vendor account and two secrets in every fork that uses it, an OAuth
  application to create by hand, and a terminal sign-in only weeks old.

### Auth0

- Pros: native in the Marketplace; long-established terminal sign-in.
- Rejected: a tenant per fork, more manual setup than Clerk, a smaller free tier.

### Descope

- Pros: a Marketplace product built for MCP sign-in.
- Rejected: its advantage needs an MCP channel adam does not have, and it has the
  smallest free tier.

### A shared password (`httpBasic`)

- Pros: built into eve and the terminal client; no helper.
- Rejected: one identity and one memory for everyone, so not a sign-in.

### No provider

- Rejected: a real provider was asked for.

## Consequences

- No vendor account, no secret and no new package: the client ID is public, and a
  deployment without it builds and behaves as before.
- Only people with a Vercel account can sign in. A fork with another audience replaces
  the one sign-in entry in `agent/channels/eve.ts`.
- The helper needs a browser on the same machine and a fixed, registered callback port.
  A sign-in lasts about an hour, after which the visitor reconnects.
- Signing in is access: the docs say what a signed-in caller can use and how a fork
  withholds it. See [Sign-in](../configuration.md#sign-in).
