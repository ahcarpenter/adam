# Configuration

## Environment

Copy `env.example` to `.env.local` and fill in:

| Variable                                              | Purpose                                                         |
| ----------------------------------------------------- | --------------------------------------------------------------- |
| `AI_GATEWAY_MODEL`                                    | AI Gateway model ID, `provider/model` (default `openai/gpt-5`)  |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Memory, RAG, chat history, rate limiting, tool cache            |
| `BRAINTRUST_API_KEY`                                  | AI trace export                                                 |
| `POSTHOG_HOST`                                        | PostHog region host (defaults to `https://us.i.posthog.com`)    |
| `POSTHOG_PROJECT_TOKEN`                               | Log export                                                      |
| `LOG_LEVEL`                                           | winston level, closed set (defaults to `info`)                  |
| `OTEL_SERVICE_NAME`                                   | `service.name` on logs and metrics (defaults to the agent name) |
| `OTEL_EXPORTER_OTLP_ENDPOINT`                         | OTLP collector: metrics, and all spans                          |
| `ALLOW_ANONYMOUS_ACCESS`                              | `true` opens the agent to anyone (defaults to `false`)          |

Startup fails fast on an invalid environment in every mode, local dev
included. `AI_GATEWAY_MODEL`, `POSTHOG_HOST`, `LOG_LEVEL`, `OTEL_SERVICE_NAME`,
and `ALLOW_ANONYMOUS_ACCESS` default; `OTEL_EXPORTER_OTLP_ENDPOINT` is genuinely
optional. `LOG_LEVEL` is a closed enum on purpose: winston resolves a level by
map lookup and drops _every_ record for one it does not recognize, so
`LOG_LEVEL=warning` would be a silent logging outage rather than an error.
`ALLOW_ANONYMOUS_ACCESS` is closed for the same kind of reason: only `true` and
`false` are accepted, so a typo fails startup instead of deciding who can reach
the agent. See [Anonymous access](#anonymous-access).

Validation lives in `agent/lib/env.ts` and runs at the earliest module load, so an
incomplete environment fails the process rather than surfacing as a confusing runtime
error later. `eve build` runs it too, through `agent/agent.ts`, so an incomplete
environment also fails the build.

## Model access

The model runs through the [Vercel AI Gateway](https://vercel.com/docs/ai-gateway):
`agent/agent.ts` passes eve a gateway model ID, and no provider key is involved.

`AI_GATEWAY_MODEL` takes any ID from the
[gateway model list](https://vercel.com/ai-gateway/models). The required form is
`provider/model`, for example `openai/gpt-5` or `anthropic/claude-sonnet-5`, not the
bare `gpt-5` a direct provider SDK takes. Startup checks only that the value is not
empty; `eve build` checks the ID against the gateway catalog and fails on a bare or
unlisted one, reporting a bare ID as missing compaction metadata without naming this
variable. eve resolves the model when it
compiles the agent, so the variable is read by `eve build` and `eve dev`, not by a
started process: changing the model means a rebuild, which on Vercel is a redeploy.

Routing through the gateway also changes eve's built-in `web_search` tool. For a
gateway model it runs on the gateway's search provider, Exa by default, where a
direct provider model used that provider's own search. An
`agent/tools/web_search.ts` can pick another provider or replace the tool.

The gateway credential is deliberately not part of the validated environment, because
where it comes from depends on where the agent runs:

- **On Vercel**, there is nothing to set. The deployment authenticates with the
  project's OIDC token.
- **Locally with an API key.** Create a key on the team's AI Gateway API Keys page
  in the Vercel dashboard and set `AI_GATEWAY_API_KEY` in `.env.local`. A key does
  not expire until it is revoked, which makes this the simpler local path.
- **Locally with a linked project.** Run `pnpm exec eve link`. It links the directory
  to a Vercel project and runs `vercel env pull`, which writes a `VERCEL_OIDC_TOKEN`
  to `.env.local`. The token lasts 12 hours, and `vercel env pull` fetches a new
  one. Each pull replaces `.env.local` with the project's Development variables, so
  on this path keep the four required values on the Vercel project, targeted at
  Development, rather than only in the file.
- **Off Vercel**, a self-hosted deployment sets `AI_GATEWAY_API_KEY`.

With neither credential, `eve build` and startup still succeed, since neither one
calls the model. The first model call is what fails, and the `eve dev` terminal
offers `/login` to connect a Vercel account or paste a key.

Calls are billed to the Vercel team's AI Gateway credits. A team new to the gateway
may have to add a payment method before its free credits apply, the free tier covers
only a subset of models, and a team with model or provider allowlists has to allow
the one configured here. The gateway
[FAQ](https://vercel.com/docs/ai-gateway/faq#why-did-my-ai-gateway-request-fail)
maps each `402` and `403` to its cause.

## Anonymous access

A deployed agent is closed by default. `agent/channels/eve.ts` ends its auth list
with eve's `placeholderAuth()`, so in production the only callers let in are the
ones `vercelOidc()` recognizes: the project's own deployments, and its Vercel team
through the eve terminal client. Every other caller gets a `401` with the code
`eve_production_auth_not_configured` on every route except the health check. A fork
keeps that until it replaces the placeholder with its own auth provider.

`ALLOW_ANONYMOUS_ACCESS=true` replaces the placeholder with eve's `none()`, which
accepts every caller without a credential. It exists for a public demo deployment.
Set it on the deployment, not in the repository, and leave it out of the Deploy
button: a fork should have to choose it.

Before turning it on:

- **Put a spend limit in front of the model first.** Every anonymous turn is a
  model call billed to the Vercel team's AI Gateway credits. Set an AI Gateway
  [budget](https://vercel.com/docs/ai-gateway/observability-and-spend/budgets) for
  the project before the first public request, and do not turn this on without one.
  The rate limit below slows one address down; it does not cap what the deployment
  spends.
- **The budget covers model calls, not tools.** The agent keeps eve's default tools,
  among them a shell and file access in its sandbox, web fetch, and web search. An
  anonymous visitor can have the model use every one, and sandbox compute is billed
  outside the gateway budget. Remove what the demo does not need, which the
  `defaultTools` option in `agent/agent.ts` does for the optional ones, and consider
  a sandbox network policy tighter than allow-all; see eve's
  [security model](https://eve.dev/docs/concepts/security-model).
- **The rate limit is 20 messages a minute per address.** The limiter is the first
  entry in the auth list, so it applies to anonymous callers before `none()` accepts
  them, and the 21st message inside a minute gets a `403`. It counts `POST`s, so one
  turn costs one slot, and it keys on the `x-forwarded-for` header. Vercel
  overwrites that header itself; on another host, make sure your proxy does, because
  a caller who can send their own picks their own bucket.
- **Every visitor is anonymous, and memory is kept per session.** eve gives all of
  them the same principal id, `anonymous`. `agent/lib/agentkit-user.ts` therefore
  keys an anonymous caller's memory and chat history by session id, so one visitor's
  saved facts are never recalled for another. The cost is that a visitor's memory
  does not follow them into their next session. Callers with an identity are still
  keyed by principal id.
- **The agent describes itself to anyone.** `GET /eve/v1/info` sits behind the same
  auth list, so an anonymous caller can read the agent's model, tools, and source
  file paths.
- **Conversations are traced in full.** This channel classifies every conversation
  as public, so Braintrust, PostHog, and the OTLP collector when one is set receive
  a visitor's complete messages and the model's output, as
  [docs/observability.md](observability.md) describes. PostHog files every
  anonymous visitor under the one distinct id `anonymous`. Say so wherever you
  publish the demo's address.

A visitor connects with eve's terminal client, with nothing to sign in to:

```sh
npx eve remote connect --url https://your-deployment.vercel.app
```

The setting only decides the last entry of the auth list. `vercelOidc()` and
`localDev()` still run ahead of it, so the callers they recognize are identified as
before.

## One-time setup (repo owner)

1. **Codecov**: add the `CODECOV_TOKEN` repository secret — activates the 95%
   coverage gate in CI.
2. **Renovate**: install the Renovate GitHub App on this repo — it picks up
   `renovate.json` and opens an onboarding PR.
3. **Upstash / Braintrust / PostHog**: provision and set the env vars above
   (locally in `.env.local`, on Vercel via `vercel env`).
4. **AI Gateway**: confirm the Vercel team can make gateway calls, and get a local
   credential; see [Model access](#model-access).
5. **GitHub repository settings**: mark the repository as a template — the
   README's **Use this template** button — and enable private vulnerability
   reporting, which the advisory link in [SECURITY.md](../SECURITY.md) relies
   on.

## Dependency pinning

`renovate.json` groups `eve` with `@upstash/agentkit-eve` and
`@upstash/agentkit-eve-extension` so they update as one unit; the rule's
`description` carries the reasoning.
