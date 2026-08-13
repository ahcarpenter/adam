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

This repository is a template. Two of its defaults matter before you point it at real
traffic:

- **Telemetry exports message content.** `recordInputs` and `recordOutputs` are enabled
  in `agent/instrumentation.ts`, so Braintrust and PostHog receive full message history
  and model output. Failure logs additionally carry a `details` payload that can include
  model input. Treat both vendors as content stores, and turn these off before handling
  regulated data. See [docs/observability.md](docs/observability.md).
- **Secrets live in the environment.** `.env*` is git-ignored and `env.example` carries
  no values. Provision real credentials through your platform's secret storage, not the
  repository.

A vulnerability in a dependency of this template — eve, the AI SDK, AgentKit — should be
reported to that project. Report it here if the flaw is in how this repository wires the
dependency together.
