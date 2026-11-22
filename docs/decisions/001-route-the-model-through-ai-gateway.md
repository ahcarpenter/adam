# ADR-001: Route the model through Vercel AI Gateway

## Status

Accepted

## Date

2026-10-01

## Context

adam called OpenAI directly through `@ai-sdk/openai`, so every environment needed
`OPENAI_API_KEY` and `OPENAI_MODEL`. Together with Upstash, Braintrust and PostHog, a
visitor clicking the README's Deploy button had to paste six values from four vendors,
and a missing one fails the build, because adam validates its environment at build
time. Vercel's own eve starters name their model with an AI Gateway model ID instead.
The planned public demo ([ADR-002](002-opt-in-anonymous-access.md)) also needed a spend
cap, and the [AI Gateway](https://vercel.com/docs/ai-gateway) offers budgets per team
or project.

## Decision

`agent/agent.ts` passes eve a gateway model ID string, read from `AI_GATEWAY_MODEL`
with the default `openai/gpt-5`. `OPENAI_API_KEY` and the OpenAI provider package leave
adam. adam's own production runs the default model; setting `AI_GATEWAY_MODEL` back to
the OpenAI model it ran before was offered and not taken. Shipped in
https://github.com/ahcarpenter/adam/pull/40 as a breaking change.

## Alternatives Considered

### Keep the direct OpenAI provider

- Pros: no change; no dependency on a Vercel team's gateway credits.
- Cons: adam stays the eve starter that asks for a provider key, every Deploy click asks
  for one more secret, and a spend cap lives in each provider's own console.
- Rejected: it keeps the longest Deploy form and gives the demo no built-in cap.

## Consequences

- On Vercel the model needs no key: the deployment authenticates with the project's
  OIDC token. Locally it needs `AI_GATEWAY_API_KEY` or a linked project; see
  [Model access](../configuration.md#model-access).
- The model is resolved when eve compiles the agent, so changing it means a rebuild,
  which on Vercel is a redeploy. `eve build` rejects an ID the gateway catalog does not
  list.
- Calls are billed to the team's AI Gateway credits, and a gateway budget is the spend
  cap for any deployment.
- eve's built-in `web_search` runs on the gateway's search provider instead of the
  model provider's own.
