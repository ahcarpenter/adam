# Configuration

## Environment

Copy `env.example` to `.env.local` and fill in:

| Variable                                              | Purpose                                                         |
| ----------------------------------------------------- | --------------------------------------------------------------- |
| `OPENAI_API_KEY` / `OPENAI_MODEL`                     | Agent model (`@ai-sdk/openai` in `agent/agent.ts`)              |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Memory, RAG, chat history, rate limiting, tool cache            |
| `BRAINTRUST_API_KEY`                                  | AI trace export                                                 |
| `POSTHOG_HOST`                                        | PostHog region host (defaults to `https://us.i.posthog.com`)    |
| `POSTHOG_PROJECT_TOKEN`                               | Log export                                                      |
| `LOG_LEVEL`                                           | winston level, closed set (defaults to `info`)                  |
| `OTEL_SERVICE_NAME`                                   | `service.name` on logs and metrics (defaults to the agent name) |
| `OTEL_EXPORTER_OTLP_ENDPOINT`                         | OTLP collector: metrics, and all spans via `"auto"`             |

Startup fails fast on an invalid environment in every mode, local dev
included. `POSTHOG_HOST`, `LOG_LEVEL`, and `OTEL_SERVICE_NAME` default;
`OTEL_EXPORTER_OTLP_ENDPOINT` is genuinely optional. `LOG_LEVEL` is a closed
enum on purpose: winston resolves a level by map lookup and drops _every_
record for one it does not recognize, so `LOG_LEVEL=warning` would be a
silent logging outage rather than an error.

Validation lives in `agent/lib/env.ts` and runs at the earliest module load, so an
incomplete environment fails the process rather than surfacing as a confusing runtime
error later.

## One-time setup (repo owner)

1. **Codecov**: add the `CODECOV_TOKEN` repository secret — activates the 95%
   coverage gate in CI.
2. **Renovate**: install the Renovate GitHub App on this repo — it picks up
   `renovate.json` and opens an onboarding PR.
3. **Upstash / Braintrust / PostHog**: provision and set the env vars above
   (locally in `.env.local`, on Vercel via `vercel env`).
4. **GitHub repository settings**: mark the repository as a template — the
   README's **Use this template** button — and enable private vulnerability
   reporting, which the advisory link in [SECURITY.md](../SECURITY.md) relies
   on.

## Dependency pinning

`renovate.json` holds `eve` below `0.33.0` deliberately. eve 0.33 dropped hook contracts
1–9, and the newest `@upstash/agentkit-eve-extension` still requires hook 9, so every
eve `>=0.33` fails `eve build`. The rule carries that reasoning inline; drop it once
Upstash publishes an extension requiring hook contract 10 or later.
