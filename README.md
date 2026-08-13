# adam: Enterprise starter for eve agents

<p align="center">
  <a href="https://github.com/ahcarpenter/adam/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/ahcarpenter/adam/ci.yml?branch=main" alt="CI"></a>
  <a href="https://github.com/ahcarpenter/adam/blob/main/LICENSE"><img src="https://img.shields.io/github/license/ahcarpenter/adam" alt="MIT license"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-24.x-brightgreen" alt="Node 24.x"></a>
  <a href="https://eve.dev"><img src="https://img.shields.io/badge/built%20with-eve-black" alt="Built with eve"></a>
</p>

<p align="center">
  <code>adam</code> is a production-shaped starting point for <a href="https://eve.dev">eve</a> agents — observability, evals, dependency automation, and a 95% coverage gate already wired together. Fork it and delete what you do not need, instead of assembling it a second time.
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> ·
  <a href="docs/configuration.md">Configuration</a> ·
  <a href="docs/observability.md">Observability</a> ·
  <a href="docs/capabilities.md">Capabilities</a> ·
  <a href="CONTRIBUTING.md">Contributing</a> ·
  <a href="https://eve.dev/docs">eve docs</a>
</p>

## Quick Start

Requires [Node.js](https://nodejs.org) `24.x` and pnpm `11.x`.

Click **Use this template** above, or clone it:

```sh
git clone https://github.com/ahcarpenter/adam.git
cd adam
pnpm install
```

Fill in the environment — startup validates every variable, in every mode:

```sh
cp env.example .env.local
```

Every variable without a default must be filled: `OPENAI_API_KEY` and
`OPENAI_MODEL`, the Upstash Redis URL and token, `BRAINTRUST_API_KEY`, and
`POSTHOG_PROJECT_TOKEN`. See [Configuration](docs/configuration.md) for the
full table.

Then start the agent:

```sh
pnpm dev            # TUI at http://127.0.0.1:2000
```

## What's included

- **Agent runtime** — [eve](https://eve.dev) with the AI SDK, model configured through
  a single validated environment variable.
- **Memory, RAG, and chat history** — Upstash Redis via AgentKit, plus per-caller rate
  limiting and a tool cache. See [capabilities](docs/capabilities.md).
- **Observability** — structured winston logs to PostHog, AI traces to Braintrust and
  PostHog LLM analytics, OTel metrics to any OTLP collector. The design, the three
  alerts worth paging on, and how to verify the pipeline are in
  [docs/observability.md](docs/observability.md).
- **Quality gates in CI** — Biome, Prettier, `tsc`, a real `eve build`, Knip, and Vitest
  at 95% project and patch coverage through Codecov.
- **Dependency automation** — Renovate, with the eve/AgentKit contract pairing already
  encoded so a bump cannot silently break `eve build`.
- **Evals** — deterministic eval suites under `evals/`, reporting to their own
  Braintrust project.

## Why this starter

- **Fails fast, everywhere.** An incomplete environment stops the process at module
  load — in local dev too, not only in production.
- **Instrumentation cannot take down the agent.** Every hook runs inside `neverThrow`,
  because eve escalates a thrown hook to a failed turn.
- **Signals earn their place.** Each metric and log line maps to a question on-call
  actually has to answer; cardinality stays in logs and traces, not in metric labels.
- **CI builds, not just typechecks.** `tsc` does not run eve's compiler, so CI runs
  `eve build` — otherwise extension contract breaks are invisible until deploy.
- **The reasoning is written down.** Comments and docs say why a decision was made, not
  what the line does.

## Commands

```sh
pnpm dev            # eve dev (TUI at http://127.0.0.1:2000)
pnpm build          # eve build
pnpm typecheck      # tsc
pnpm lint           # biome lint --write . (auto-fix)
pnpm lint:check     # biome lint . (no writes)
pnpm lint:ci        # biome ci . (lint + format, CI mode)
pnpm format         # biome check --write + prettier --write (md/yml/css)
pnpm format:check   # biome check + prettier --check
pnpm test           # vitest run
pnpm test:coverage  # vitest run --coverage (95% thresholds)
pnpm eval           # eve eval
pnpm knip           # dead code / unused dependency scan
```

## Learn More

- [Configuration](docs/configuration.md) — environment variables and one-time setup
- [Observability design](docs/observability.md) — signals, alerts, verification
- [Upstash capabilities](docs/capabilities.md) — memory, RAG, rate limiting, tool cache
- [Spec, plan, and task history](specs/enterprise-boilerplate.md)
- [eve documentation](https://eve.dev/docs)

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) to get started, and
[SUPPORT.md](SUPPORT.md) for where to ask questions.

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). Security
vulnerabilities go through [SECURITY.md](SECURITY.md), never the issue tracker.

## License

MIT — see [LICENSE](LICENSE).
