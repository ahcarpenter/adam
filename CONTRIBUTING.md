# Contributing

Welcome — thanks for your interest in improving `adam`.

This project is a starter template for [eve](https://eve.dev) agents. Contributions
that make the skeleton clearer, safer, or easier to fork are especially valuable;
contributions that add domain-specific features usually belong in a fork instead.

## Ways to contribute

- Fix or report a bug.
- Improve the tests, the docs, or a confusing comment.
- Report problems you hit during installation or first run.
- Propose a change to the tooling, observability wiring, or defaults.

## Community guidelines

Be respectful. We follow the
[Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md).

## Filing an issue

Search the [open issues](https://github.com/ahcarpenter/adam/issues) first — if one
already covers your case, add your details as a comment rather than opening a duplicate.

Otherwise pick the matching form at
[new issue](https://github.com/ahcarpenter/adam/issues/new/choose):

- **Bug report** — something behaves differently than documented.
- **Feature suggestion** — something the starter should do and does not.
- **Question** — you are unsure how a piece works.

Security vulnerabilities do not go in the issue tracker. See [SECURITY.md](SECURITY.md).

## Development

Requires Node.js `24.x` (see [`.nvmrc`](.nvmrc)) and pnpm `11.x`.

```sh
pnpm install
cp env.example .env.local          # then fill it in — startup validates every var
pnpm dev                           # eve dev, TUI at http://127.0.0.1:2000
```

Before opening a pull request, run what CI runs:

```sh
pnpm lint:check                    # biome lint
pnpm format:check                  # biome check + prettier (md/yml/css)
pnpm typecheck                     # tsc
pnpm build                         # eve compile + bundle
pnpm knip                          # dead code / unused dependencies
pnpm test:coverage                 # vitest, 95% thresholds
```

`pnpm lint` and `pnpm format` are the auto-fixing variants of the first two.

See [docs/configuration.md](docs/configuration.md) for the environment variables and
[docs/observability.md](docs/observability.md) for how the telemetry is wired.

### Testing expectations

Coverage is gated at 95% for both the project and the patch. The unit-testable surface
is `agent/lib/**`; the wiring files that the eve runtime executes at startup —
`agent/agent.ts`, `agent/instrumentation.ts`, `agent/channels/**`,
`agent/extensions/**`, `agent/hooks/**` — are excluded from coverage in both
[`vitest.config.ts`](vitest.config.ts) and [`codecov.yml`](codecov.yml). If you add
logic worth testing, put it in `agent/lib/` so it can be tested.

Eve snapshots tool files and resolves only package imports, so any `agent/tools/*.ts`
file must be self-contained — repeat configuration rather than importing shared `agent/`
modules.

## Pull request lifecycle

We use the
[fork-and-pull model](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/getting-started/about-collaborative-development-models#fork-and-pull-model):

1. Fork the repository.
2. Create a topic branch from `main`.
3. Make your changes and run the checks above locally.
4. Push to your fork and open a pull request against `main`.
5. Respond to review feedback.

Keep a pull request to a single goal. A change that does three things is three pull
requests, and it will be reviewed faster as three.

For anything non-trivial, open an issue to discuss the approach before writing the code.
A contribution can be declined if it does not fit the project's goals, and it is better
to learn that before you have written it.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/):

```
feat(observability): emit failure logs and a throttling signal
fix: correct using-agent-skills reference to plugin-scoped name
docs: record the observability design and alerts
```

Group related changes into one commit. Write the message for someone reading `git log`
a year from now — say what changed and why, not what file you touched.

## Response times

Issues and pull requests are reviewed within **5 business days**, best effort. This is a
single-maintainer project; see [GOVERNANCE.md](GOVERNANCE.md) for how decisions are made.

The quality of the information in your issue or pull request directly affects how fast
it can be acted on. If the project is not archived, it is maintained.

## Licensing

Contributions are accepted under the same license as the project — MIT, see
[LICENSE](LICENSE). By opening a pull request you confirm you wrote the contribution or
otherwise have the right to submit it under that license.

## Writing style

- Be concise, and link out rather than restating.
- Explain _why_ a thing is the way it is. What it does is visible in the code; why it
  had to be that way is not.
- Keep documentation scannable — short sections, bullets over paragraphs.
