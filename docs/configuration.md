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
| `ALLOW_ANONYMOUS_ACCESS`                              | `true` opens a chat-only agent to anyone (defaults to `false`)  |
| `VERCEL_APP_CLIENT_ID`                                | Client ID of a Sign in with Vercel app; unset means no sign-in  |

The Redis credentials are accepted under either of two pairs of names:
`UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`, or `KV_REST_API_URL` and
`KV_REST_API_TOKEN`. The second pair is what an Upstash store from the
[Vercel Marketplace](https://vercel.com/marketplace/upstash/upstash-kv) sets on a
project, including the store the README's Deploy button creates, so that deployment
needs no Redis value entered by hand. When both pairs are set, the `UPSTASH_` pair is
used. A pair must be set whole: one name without the other fails startup, naming the
missing one.

The PostHog token and host are accepted under two pairs of names in the same way:
`POSTHOG_PROJECT_TOKEN` and `POSTHOG_HOST`, or `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` and
`NEXT_PUBLIC_POSTHOG_HOST`. The second pair is what the PostHog integration from the
[Vercel Marketplace](https://vercel.com/marketplace/posthog) sets on a project, so a
project with that integration added needs no PostHog value entered by hand. The
README's Deploy button does not add it: the button asks for `POSTHOG_PROJECT_TOKEN`,
because whether a Deploy button can provision that kind of Marketplace product has not
been confirmed. The prefix is only part of the name: adam is not a Next.js app, and the
project token is not a secret. When either `POSTHOG_` name is set,
that pair is used and the other is ignored, so a token set by hand is never sent to the
integration's host. The `NEXT_PUBLIC_` pair must be set whole, with no default host: the
integration sets the host of the region its token belongs to, and nothing sent to the
other region's host reaches the project. A PostHog organization the Marketplace creates
is billed through the Vercel team, and its region is chosen when it is created.

Startup fails fast on an invalid environment in every mode, local dev
included. `AI_GATEWAY_MODEL`, `POSTHOG_HOST`, `LOG_LEVEL`, `OTEL_SERVICE_NAME`,
and `ALLOW_ANONYMOUS_ACCESS` default; `OTEL_EXPORTER_OTLP_ENDPOINT` and
`VERCEL_APP_CLIENT_ID` are genuinely optional. `LOG_LEVEL` is a closed enum on purpose: winston resolves a level by
map lookup and drops _every_ record for one it does not recognize, so
`LOG_LEVEL=warning` would be a silent logging outage rather than an error.
`ALLOW_ANONYMOUS_ACCESS` is closed for the same kind of reason: only `true` and
`false` are accepted, so a typo fails startup instead of deciding who can reach
the agent. See [Anonymous access](#anonymous-access). `VERCEL_APP_CLIENT_ID` is
optional so that a fork with no app registered still builds; set but empty, it fails
startup. See [Sign-in](#sign-in).

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
  on this path keep the required values on the Vercel project, targeted at
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

## Sign-in

adam's sign-in provider is
[Sign in with Vercel](https://vercel.com/docs/sign-in-with-vercel). It is off until a
deployment sets `VERCEL_APP_CLIENT_ID` to the client ID of a Sign in with Vercel app
registered on its own Vercel team. With it set, a caller who signs in is a named user:
`agent/lib/vercel-sign-in.ts` verifies the ID token Vercel issued them with eve's own
`verifyOidc()`, against the signing keys Vercel publishes, and with the client ID as
the audience, so only a token issued to this deployment's app is accepted.

It adds no vendor account, no secret, and no package. The client ID is a public value:
it is the identifier every sign-in request carries. The cost is that only someone with
a Vercel account can sign in. To use another identity provider, replace the one sign-in
entry in the auth list in `agent/channels/eve.ts`.

The two access settings combine like this in production:

| `ALLOW_ANONYMOUS_ACCESS` | `VERCEL_APP_CLIENT_ID` | Who gets in                                                                                                                                                 |
| ------------------------ | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| off                      | unset                  | The project's own deployments and its Vercel team. Everyone else gets a `401` with the code `eve_production_auth_not_configured`. This is every fresh fork. |
| off                      | set                    | Those, and anyone who signs in, each as a named user. Everyone else gets a plain `401` with a `Bearer` challenge.                                           |
| on                       | unset                  | Anyone, anonymously. See [Anonymous access](#anonymous-access).                                                                                             |
| on                       | set                    | Anyone. A caller who signs in is a named user; the rest are anonymous.                                                                                      |

Where sign-in is configured, a token that claims Vercel as its issuer and fails
verification, because it has expired or was issued to another app, is rejected with a
`401` and the code `sign_in_not_accepted`. It is never passed on as an anonymous
caller, so an expired sign-in fails loudly instead of quietly becoming a visitor.

### What a signed-in user gets

- **Their own identity.** The caller is a `user` whose principal id is
  `https://vercel.com:` followed by their Vercel user id. Memory and chat history are
  keyed by that id (`agent/lib/agentkit-user.ts`), so they follow the person from one
  session to the next and are shared with no one. They are not expired: the 24-hour
  expiry applies to anonymous sessions only.
- **The shell, file and web-fetch tools on a deployment that also admits anonymous
  callers**, where an anonymous caller gets none of eve's default tools. See
  [Anonymous access](#anonymous-access).
- **Their conversations are traced in full, exactly as every conversation is.**
  Signing in does not reduce what is captured. Braintrust, PostHog, and the OTLP
  collector when one is set receive a signed-in user's complete messages and the
  model's output, and Braintrust and PostHog receive their principal id with it, which
  contains their Vercel user id. PostHog files a session's model calls under the
  principal id of whoever started the session. So a signed-in user's conversations are
  stored in those services under an id that names their Vercel account. Say so wherever
  you invite people to sign in. What is captured is decided in two places, neither of
  which this feature changes: the `audience: "public"` line in `agent/channels/eve.ts`
  and the trace policy in `agent/instrumentation/otel.ts`.
  [docs/observability.md](observability.md) describes both.

The helper below asks Vercel for the `openid` scope only, and the app is registered
with that scope only, so the ID token identifies the user by id. Vercel documents that
an email address and a name are added only when the `email` and `profile` scopes are
requested.

Vercel team members can still reach production with no sign-in, through eve's terminal
client and `vercelOidc()`. That path identifies the project, not the person: every team
member arrives as the same `service` principal and they share one memory and one chat
history. A team member who wants their own signs in instead.

### Register the app

Do this once per deployment, on the Vercel team that owns the project. It takes three
calls to `vercel api /oauth-apps`, with the [Vercel CLI](https://vercel.com/docs/cli)
signed in. These are the routes Vercel's own eve chat template uses to register its
app; they are not in the CLI's list of public endpoints.

Create the app, with the `openid` scope and nothing else. Choose your own name and
slug. The response includes the app's `clientId`, which starts with `cl_`:

```sh
echo '{"name":"adam","slug":"adam","scopes":["openid"]}' \
  | vercel api /oauth-apps --scope <team> -X POST --input -
```

Make it a public client. The terminal helper holds no secret, so the app must accept a
token request without one:

```sh
echo '{"clientAuthenticationMethods":{"none":true,"client_secret_basic":false,"client_secret_post":false}}' \
  | vercel api /oauth-apps/<clientId> --scope <team> -X PATCH --input -
```

Register the helper's callback, exactly as written:

```sh
echo '{"redirectUris":["http://127.0.0.1:53682/callback"]}' \
  | vercel api /oauth-apps/<clientId> --scope <team> -X PATCH --input -
```

Never generate a client secret for the app: nothing here uses one.

Then set `VERCEL_APP_CLIENT_ID` to the `clientId` on the Vercel project and redeploy.
It is read when the agent starts. Leave it out of the Deploy button, like
`ALLOW_ANONYMOUS_ACCESS`: an app belongs to one team, so a fork registers its own.

By default anyone with a Vercel account can sign in to an app. Vercel can instead
restrict an app to members of the team that owns it, a setting on the app described
under [sign-in access](https://vercel.com/docs/sign-in-with-vercel/manage-from-dashboard).
adam's own production app keeps the default, anyone with a Vercel account, because
signing in there only gives a caller their own identity.

### Connect from a terminal

eve's terminal client has no sign-in of its own: it can only send a header it is given.
`pnpm connect` signs you in and hands the client the token:

```sh
pnpm connect https://your-deployment.vercel.app
```

It needs the app's client ID, from `--client-id cl_...` or from `VERCEL_APP_CLIENT_ID`
in the environment or in `.env.local`. It reads that one value from `.env.local` and
nothing else. The client ID is not a secret, so publish it beside the deployment's
address for anyone you want to be able to sign in.

The command opens Vercel's sign-in page in your browser, waits for Vercel to send the
browser back to `http://127.0.0.1:53682/callback`, exchanges the code it receives for
an ID token, and starts `eve remote connect` with that token as its bearer header. The
flow is the authorization code grant with PKCE as a public client. Vercel does not
offer the device grant to Sign in with Vercel apps, and that decides the costs:

- **It needs a browser on the same machine as the terminal.** Over SSH or in a remote
  container it does not work unless port 53682 is forwarded to that machine.
- **It needs one fixed port, 53682.** The app registers the exact callback address, so
  no other port will do. If the port is in use the command stops and says so before it
  opens the browser.
- **The token is passed to eve's client as a command-line argument**, the only way that
  client takes a header, so it is visible in that machine's process list for as long as
  the client runs.
- **The sign-in lasts as long as the ID token.** eve's client cannot refresh it. The
  command prints when it expires; after that the agent answers `401` with the code
  `sign_in_not_accepted`, and you run the command again.

Any other client signs in the same way, by sending the ID token as
`Authorization: Bearer <token>`. `Client` from `eve/client` takes a function for
`auth.bearer`, which a long-lived integration can use to supply a fresh token on each
request.

Three things are not verified here, because they need a person to sign in to Vercel in
a browser: that the consent page accepts the callback address above and redirects to
it, that eve accepts the ID token a real sign-in returns, and how long that token
lasts. Everything else is tested against a local stand-in for Vercel: the token checks
in `agent/lib/vercel-sign-in.test.ts`, the four rows of the table above in
`agent/channels/eve.test.ts`, and the helper's whole flow in `scripts/sign-in.test.ts`.

## Anonymous access

A deployed agent is closed by default. `agent/channels/eve.ts` ends its auth list
with eve's `placeholderAuth()`, so in production the only callers let in are the
ones `vercelOidc()` recognizes: the project's own deployments, and its Vercel team
through the eve terminal client. Every other caller gets a `401` with the code
`eve_production_auth_not_configured` on every route except the health check. A fork
keeps that until it configures [sign-in](#sign-in), opens the agent as described here,
or puts its own auth provider in the list.

`ALLOW_ANONYMOUS_ACCESS=true` ends the list with eve's `none()` instead, which accepts
every caller without a credential, and builds the agent without eve's default tools,
so an anonymous caller is offered none of them. It exists for a public chat demo
deployment.
Set it on the deployment, not in the repository, and leave it out of the Deploy
button: a fork should have to choose it.

Before turning it on:

- **Put a spend limit in front of the model first.** Every anonymous turn is a
  model call billed to the Vercel team's AI Gateway credits. Set an AI Gateway
  [budget](https://vercel.com/docs/ai-gateway/observability-and-spend/budgets) for
  the project before the first public request, and do not turn this on without one.
  The rate limit below slows one address down; it does not cap what the deployment
  spends.
- **Turning it on takes eve's default tools away from anonymous callers, and some of
  them from everyone.** An anonymous visitor must not reach the sandbox shell
  (`bash`), sandbox files (`read_file`, `write_file`), `web_fetch`, `web_search`, or
  the sub-agent (`agent`), so `agent/agent.ts` sets `defaultTools: false` whenever
  this setting is `true`. Four of them come back for a caller who has an identity,
  meaning anyone the auth list recognized before it reached `none()`: a signed-in
  user, the project's own deployments and Vercel team, and local development.
  `agent/tools/bash.ts`, `read_file.ts`, `write_file.ts` and `web_fetch.ts` then export
  a resolver that eve runs at the start of every turn, which offers the tool to an
  identified caller and nothing to an anonymous one. The rule is one function,
  `identifiedCaller` in `agent/lib/caller.ts`, and it judges the caller of the turn,
  not of the session: an anonymous follow-up on a signed-in user's session gets no
  tools. `web_search`, the sub-agent and `task_cancel` do not come back for anyone,
  because eve fixes those when the agent is built and cannot decide them per caller.
  `load_skill` stays off as well: adam ships no skills for it to load. To give
  signed-in callers every default tool, run a deployment with this setting off. With it off, nothing changes: the four files export eve's own tool, and
  the agent has every default tool, as before. `agent/caller-tools.test.ts` runs a
  built agent to pin all of this.
- **Document search stays, and its index is shared.** What remains is chat plus
  what the AgentKit extension contributes, none of it a default tool: memory, chat
  history, and the document search tools `search`, `search_aggregate` and
  `search_count`. Memory and chat history are kept per visitor, as described below.
  The search index is not: it is the deployment's one shared index, so with this
  setting on every document in it is readable by anyone. Put only public material
  in it.
- **Set it for the build as well as the running process.** The auth list is read
  when the agent starts, the tool set when `eve build` or `eve dev` compiles it. On
  Vercel both read the same project variable, and changing it takes a redeploy. If
  you build and start in separate steps elsewhere, give both the same value. An
  agent built with one value and started with the other does not serve: under eve
  0.68 every request gets a `500`, and the log names one of the four tool files,
  because what the file exports no longer matches what was compiled. That includes
  the dangerous case, an agent built with `false`, default tools compiled in, and
  started with `true`.
- **The rate limit is 20 messages a minute per address.** The limiter is the first
  entry in the auth list, so it applies to anonymous callers before `none()` accepts
  them, and the 21st message inside a minute gets a `403`. It counts `POST`s, so one
  turn costs one slot, and it keys on the `x-forwarded-for` header. Vercel
  overwrites that header itself; on another host, make sure your proxy does, because
  a caller who can send their own picks their own bucket.
- **Every visitor who has not signed in is anonymous, and their memory is kept per
  session.** eve gives all of them the same principal id, `anonymous`. `agent/lib/agentkit-user.ts` therefore
  keys an anonymous caller's memory and chat history by session id, so one visitor's
  saved facts are never recalled for another. The cost is that a visitor's memory
  does not follow them into their next session. Callers with an identity are still
  keyed by principal id, so a visitor who [signs in](#sign-in) keeps their memory
  from session to session.
- **Anonymous memory and chat history expire after 24 hours.** At the end of every
  turn of an anonymous session, `agent/hooks/anonymous-expiry.ts` sets a 24-hour
  Redis expiry on that session's chat-history key and on each of its memory keys, so
  they expire 24 hours after the session's last turn. Signed-in callers' data is not
  expired by this, nor any other principal's, and the extension's own deployment-wide
  chat-history `ttlSeconds` stays off. A memory saved in a turn that never finishes
  keeps no expiry until the session's next turn. The memory keys are found with a
  `SCAN` under the session's own key prefix, which costs more as the database grows.
  Two things are not verified here, because they need a live Upstash database: how
  Upstash treats an existing expiry when a document is rewritten, and whether its
  search index drops expired memory documents.
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

The setting decides two things: the last entry of the auth list, and which of eve's
default tools the agent is built with. `vercelOidc()`, sign-in when it is configured,
and `localDev()` still run ahead of that last entry, so the callers they recognize are
identified as before. Those callers get the shell, file and web-fetch tools; no caller
on such a deployment gets web search or the sub-agent.

## One-time setup (repo owner)

1. **Codecov**: add the `CODECOV_TOKEN` repository secret — activates the 95%
   coverage gate in CI.
2. **Renovate**: install the Renovate GitHub App on this repo — it picks up
   `renovate.json` and opens an onboarding PR.
3. **Upstash / Braintrust / PostHog**: provision and set the env vars above
   (locally in `.env.local`, on Vercel via `vercel env`). The Deploy button
   provisions Upstash itself.
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
