# Security Policy

## Reporting a vulnerability

**Do not open a public issue for a security vulnerability.**

Report it privately through GitHub:

**[Report a vulnerability](https://github.com/ahcarpenter/adam/security/advisories/new)**

Private vulnerability reporting is enabled on this repository, so that form creates a
draft advisory visible only to you and the maintainer. If you cannot use it, email
<drewwcarpenter@gmail.com> instead.

### What to include

1. **Project** — the repository and the affected commit, tag, or version.
2. **Public** — whether the issue has already been discussed or disclosed publicly, with
   links if so.
3. **Description** — what the vulnerability is, how to reproduce it, and what an attacker
   gains. Proof-of-concept code, logs, or a failing test all help.
4. **Impact** — which deployments are affected and under what configuration.

## What to expect

- Acknowledgement within **5 business days**.
- An assessment of whether the report is accepted, with reasoning either way.
- A best-effort fix. This is a single-maintainer project, so there is no guaranteed
  remediation window.
- Coordinated disclosure: please keep the report confidential until a fix is published.
  You will be notified at the same time as the public announcement, and credited in the
  advisory unless you ask not to be.

## Supported versions

| Version          | Supported |
| ---------------- | --------- |
| `main`           | Yes       |
| Anything earlier | No        |

There are no tagged releases yet. Fixes land on `main`.

## Security notes for anyone deploying this starter

This repository is a template. Three things about it matter before you point it at
real traffic:

- **A deployment is closed until you open it.** `agent/channels/eve.ts` rejects every
  production caller its auth list does not recognize, which leaves the project's own
  Vercel deployments and team, until you replace eve's placeholder with an auth
  provider. `ALLOW_ANONYMOUS_ACCESS=true` opens it to anyone instead, for a public
  demo, and in the same step removes eve's default tools from the agent for every
  caller: no sandbox shell or files, no web fetch, no web search, no sub-agent. A
  visitor gets chat with memory and chat history kept per session, can spend the
  model budget limited only to 20 messages a minute per address, and everything they
  send is exported as the next point describes. The tools are removed when the agent
  is built, so the setting has to be present at build time too. Do not set it without
  a spend limit in front of the model. See
  [Anonymous access](docs/configuration.md#anonymous-access).

- **Telemetry exports message content.** The trace policy in
  `agent/instrumentation/otel.ts` sets `recordInputs` and `recordOutputs` to `true` for
  every environment and audience, and `agent/channels/eve.ts` classifies every
  conversation as `public` so eve does not cap private and anonymous ones to metadata.
  Braintrust, PostHog, and the OTLP collector (when `OTEL_EXPORTER_OTLP_ENDPOINT` is set)
  therefore receive full message history and model output. Failure logs additionally carry
  a `details` payload that can include model input. Treat all three as content stores, and
  turn these off before handling regulated data. Vercel Agent Runs receives operational
  metadata without message content or user identifiers:
  `agent/instrumentation/agent-runs.ts` redacts inputs and outputs from every span it
  gets and drops principal ids, the principal-scoped memory store id, and app-authored
  runtime context such as the PostHog distinct id. See [docs/observability.md](docs/observability.md).
- **Secrets live in the environment.** `.env*` is git-ignored and `env.example` carries
  no values. Provision real credentials through your platform's secret storage, not the
  repository.

A vulnerability in a dependency of this template — eve, the AI SDK, AgentKit — should be
reported to that project. Report it here if the flaw is in how this repository wires the
dependency together.
