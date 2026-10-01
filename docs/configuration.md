# Configuration

## Environment

Copy `env.example` to `.env.local` and fill in:

| Variable                                              | Purpose                                                         |
| ----------------------------------------------------- | --------------------------------------------------------------- |
| `AI_GATEWAY_MODEL`                                    | AI Gateway model ID (defaults to `openai/gpt-5`)                |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Memory, RAG, chat history, rate limiting, tool cache            |
| `BRAINTRUST_API_KEY`                                  | AI trace export                                                 |
| `POSTHOG_HOST`                                        | PostHog region host (defaults to `https://us.i.posthog.com`)    |
| `POSTHOG_PROJECT_TOKEN`                               | Log export                                                      |
| `LOG_LEVEL`                                           | winston level, closed set (defaults to `info`)                  |
| `OTEL_SERVICE_NAME`                                   | `service.name` on logs and metrics (defaults to the agent name) |
| `OTEL_EXPORTER_OTLP_ENDPOINT`                         | OTLP collector: metrics, and all spans                          |

Startup fails fast on an invalid environment in every mode, local dev
included. `AI_GATEWAY_MODEL`, `POSTHOG_HOST`, `LOG_LEVEL`, and
`OTEL_SERVICE_NAME` default; `OTEL_EXPORTER_OTLP_ENDPOINT` is genuinely
optional. `LOG_LEVEL` is a closed enum on purpose: winston resolves a level by
map lookup and drops _every_ record for one it does not recognize, so
`LOG_LEVEL=warning` would be a silent logging outage rather than an error.

Validation lives in `agent/lib/env.ts` and runs at the earliest module load, so an
incomplete environment fails the process rather than surfacing as a confusing runtime
error later. `eve build` runs it too, through `agent/agent.ts`, so an incomplete
environment also fails the build.

## Model access

The model runs through the [Vercel AI Gateway](https://vercel.com/docs/ai-gateway):
`agent/agent.ts` passes eve a gateway model ID, and no provider key is involved.

`AI_GATEWAY_MODEL` takes any ID from the
[gateway model list](https://vercel.com/ai-gateway/models), in the form
`creator/model`. A bare provider ID such as `gpt-5` is rejected, and so is an ID the
gateway does not list, which `eve build` reports. eve resolves the model when it
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
