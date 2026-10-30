# ADR-002: Open access to anonymous callers only as an opt-in setting

## Status

Accepted

## Date

2026-10-01

## Context

eve fails closed: in production it rejects every caller no authenticator accepts, and
adam's auth list ended with eve's `placeholderAuth()`, so its own production answered
only the health check and `401` everywhere else. adam's own deployment was to become a
public chat demo with a spend cap, which a visitor reaches with eve's terminal client.
adam is also a template, and whatever its auth list does by default, every fork
inherits.

## Decision

`ALLOW_ANONYMOUS_ACCESS`, off by default, ends the auth list in
`agent/channels/eve.ts` with eve's `none()`. A fork stays closed until it opts in on its
own deployment; the setting is kept out of the Deploy button. With it on:

- The existing rate limit of 20 messages a minute per address runs first, so it also
  throttles anonymous callers.
- The agent is built without eve's default tools, so an anonymous caller can chat and
  use memory, chat history and document search, but cannot run commands, read or write
  files, fetch pages, search the web, or start a sub-agent.
- Anonymous memory and chat history are keyed by session id rather than by eve's
  single `anonymous` principal, so one visitor's saved facts are never recalled for
  another, and they expire 24 hours after the session's last turn.

adam's own production was opened only after the model ran through the AI Gateway
([ADR-001](001-route-the-model-through-ai-gateway.md)) under a gateway budget. Shipped
in https://github.com/ahcarpenter/adam/pull/43.

## Alternatives Considered

### Keep production closed and point at its health page

- Pros: honest and free to run.
- Cons: nobody can talk to the agent, so it demonstrates nothing.
- Rejected: a demo was wanted.

### Make open access the starter's default

- Pros: a fresh deploy can chat at once.
- Cons: every fork would expose its model budget to anyone until it noticed.
- Rejected: forks keep eve's closed default.

### Add a web chat page

- Rejected: a larger build that changes what adam is, a headless agent.

### Keep the default tools for anonymous callers

- Options offered: keep them and tighten the sandbox network policy, or accept them as
  they are.
- Rejected: an anonymous visitor could run commands in the sandbox and fetch arbitrary
  pages on the deployment's budget.

## Consequences

- The spend cap is an AI Gateway budget on the Vercel account, not something the
  repository can enforce; the docs require one before the setting is turned on.
- The tool set is fixed when the agent is built and the auth list when it starts, so
  both must see the same value; a mismatch makes every request fail with `500`.
- The document search index is shared by every caller, so an open deployment must hold
  only public material in it.
- Every anonymous conversation is traced in full, and PostHog files all of them under
  one distinct id. See [Anonymous access](../configuration.md#anonymous-access).
