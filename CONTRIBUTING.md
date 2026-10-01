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

Requires Node.js `24.x` (see [`.nvmrc`](.nvmrc)) and pnpm `12.x`.

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

`pnpm build` also prepares the agent's sandbox, as eve 0.68 does on every build. Off
Vercel, eve picks Docker when the Docker daemon answers within about 5 seconds, and
otherwise falls back to microsandbox (Apple Silicon macOS, or Linux with KVM) or else
just-bash, neither of which adam installs, so the build fails.
Either have Docker running, or run `pnpm build --skip-sandbox-prewarm` for a
compile-only check, which is what CI runs. Do not deploy output built that way: it may
not be able to start its sandbox.

See [docs/configuration.md](docs/configuration.md) for the environment variables and
[docs/observability.md](docs/observability.md) for how the telemetry is wired.

### Agent tooling

The repository commits tooling for the coding agents that work on it, at Claude Code's
project scope, so it applies in this repository only, not across your other projects.

| What        | Where                                                                       | From                                                                      |
| ----------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| MCP servers | [`.mcp.json`](.mcp.json)                                                    | Vercel, Braintrust, PostHog                                               |
| Plugin      | [`.claude/settings.json`](.claude/settings.json)                            | [`vercel/vercel-plugin`](https://github.com/vercel/vercel-plugin)         |
| Skills      | [`.claude/skills/`](.claude/skills), [`skills-lock.json`](skills-lock.json) | [`vercel-labs/agent-skills`](https://github.com/vercel-labs/agent-skills) |

None of it ships in the deployed agent: eve loads skills from `agent/skills/` only, and
nothing here is placed there.

#### MCP servers

`.mcp.json` registers the hosted MCP server of every provider that can sign in through
the browser: `vercel`, `braintrust`, and `posthog`.

- **Approval:** Claude Code asks you to approve each server the first time you start
  `claude` in a checkout. Approvals are stored on your machine, not in the repository,
  so a fork or a fresh clone is asked again for all three. Approve only the ones you
  use; `claude mcp reset-project-choices` clears your answers.
- **Sign-in:** every server authenticates with OAuth, and nothing secret is committed.
  Sign in to each one separately: run `/mcp`, select the server, choose
  **Authenticate**, and finish in your browser, or run `claude mcp login <name>` from
  your shell. `/mcp` then lists it as connected, and it acts with the permissions of
  the account you signed in with.
- **No keys in `.mcp.json`:** a server that needs a key or token does not belong in a
  committed file. That is why Upstash's MCP server is absent, although adam uses
  Upstash: it authenticates with an API key. Add a server like that to your own config
  with `claude mcp add --scope local`, which stores it in `~/.claude.json`.
- **Generic endpoints:** each URL is the provider's generic one because this is a
  template: a URL tied to one team, project, or region would tie every fork to it. Keep
  a scoped URL in your own config the same way. A local entry with the same name takes
  precedence over the shared one for that checkout.

##### `vercel`

Vercel's [MCP server](https://vercel.com/docs/agent-resources/vercel-mcp), at
`https://mcp.vercel.com`. Once you log in, an agent can use it to:

- **Deploy:** create a preview or production deployment from a Git source or files
  (`create_deployment`), or cancel one (`cancel_deployment`).
- **Inspect deployments:** list and filter them by state, branch, or commit
  (`list_deployments`, `get_deployment`), and read their build logs
  (`list_deployment_events`).
- **Check a deployment:** fetch pages from it, including protected previews
  (`web_fetch_vercel_url`).
- **Debug production:** read grouped runtime errors and filtered runtime logs
  (`get_runtime_errors`, `get_runtime_logs`).
- **Look things up:** find your teams and projects, and search Vercel's docs.

It acts with your Vercel account's permissions. The
[tools reference](https://vercel.com/docs/agent-resources/vercel-mcp/tools) lists
everything else it exposes.

- When you sign in, grant access to the team that owns your project.
- For a URL scoped to your own team and project, run `vercel mcp --project` in a
  checkout linked with `vercel link`. Keep that URL in your own Claude Code config, not
  in `.mcp.json`: `claude mcp add --transport http --scope local vercel <url>` stores it
  in `~/.claude.json` and takes precedence over the shared entry for this checkout.

##### `braintrust`

Braintrust's [MCP server](https://www.braintrust.dev/docs/integrations/developer-tools/mcp),
at `https://api.braintrust.dev/mcp`. It reads and writes the Braintrust organization
you sign in to, which is where adam sends its AI traces: an agent can query logs and
traces, write prompts and scorers, edit datasets, and run evals.

- The committed URL is the US data plane. An EU organization uses
  `https://api-eu.braintrust.dev/mcp`, and a self-hosted one the MCP URL shown under
  **Settings > Data plane**. Add yours as a local entry named `braintrust`.
- This sign-in is separate from `bt login`, which authenticates the Braintrust CLI.

##### `posthog`

PostHog's [MCP server](https://posthog.com/docs/model-context-protocol), at
`https://mcp.posthog.com/mcp`. It reads and writes the PostHog project you sign in to,
which is where adam sends its logs and LLM analytics: an agent can run queries, read
error tracking, and manage insights and feature flags.

- One endpoint serves both regions: the sign-in routes you to US or EU by account.
- One connection is one account, with one active organization and project.
- To stop an agent writing to your project, add a local entry named `posthog` with
  `https://mcp.posthog.com/mcp?readonly=true`.

#### Vercel plugin

`.claude/settings.json` enables `vercel@claude-plugins-official`, which is
[`vercel/vercel-plugin`](https://github.com/vercel/vercel-plugin) as published in
Claude Code's official marketplace. It adds Vercel skills, subagents, and commands, and
injects Vercel context at session start because it detects an eve project.

- **Install it once:** a committed entry turns the plugin on but does not download it.
  Run `claude plugin install vercel@claude-plugins-official --scope project` in the
  repo. Until you do, the `/plugin` **Errors** tab reports it as enabled but not
  installed. The command leaves `.claude/settings.json` unchanged.
- **Telemetry is on by default:** the plugin reports its version, a random
  installation id, the agent you run it in, and the names of its own skills that get
  used. Set `VERCEL_PLUGIN_TELEMETRY=off` in the environment that launches your agent
  to disable it. Its
  [README](https://github.com/vercel/vercel-plugin#telemetry) lists every field.
- **It carries the same `vercel` MCP server:** the plugin bundles an entry for
  `https://mcp.vercel.com`. Claude Code connects to that endpoint once, using the
  `.mcp.json` entry, which outranks a plugin's.
- **Other agents:** the plugin also supports Cursor, Codex, and others through
  `npx plugins add vercel/vercel-plugin`, which installs to your user profile, not to
  the repository.

#### Vercel agent skills

`.claude/skills/` vendors three skills from
[`vercel-labs/agent-skills`](https://github.com/vercel-labs/agent-skills). Claude Code
loads them on demand, with nothing to install.

| Skill                | Use it to                                                               |
| -------------------- | ----------------------------------------------------------------------- |
| `deploy-to-vercel`   | Deploy the project to Vercel                                            |
| `vercel-optimize`    | Audit a deployed project's cost and performance from its Vercel metrics |
| `writing-guidelines` | Review docs and prose against Vercel's writing handbook                 |

- **Why only three:** the rest of that repository targets React, React Native, or web
  UI, which a headless agent has none of, or, in the case of `vercel-cli-with-tokens`,
  has an agent read a token out of `.env` files.
- **`vercel-optimize` is limited here:** the skill treats frameworks other than
  Next.js, SvelteKit, Nuxt, and Astro as unsupported. On this headless eve agent its
  preflight stops and offers only a limited platform and scanner audit.
- **Do not edit them:** they are copied from upstream as-is, which is why Biome and
  Prettier skip `.claude/skills/`. [`skills-lock.json`](skills-lock.json) records each
  skill's source and content hash.
- **Refresh them by name, for a named agent:** run the command below and commit the
  result together with the lock file.

  ```sh
  npx skills add vercel-labs/agent-skills \
    --skill deploy-to-vercel vercel-optimize writing-guidelines \
    --agent claude-code --yes
  ```

  `--skill '*'` would bring back every skill in that repository. This is an eve
  project, so without `--agent` the installer targets eve and writes into
  `agent/skills/`, which would ship the skills inside the deployed agent.
  `npx skills update` does exactly that, because it takes no agent: do not use it here.

- **Skills run with your agent's permissions:** read one before relying on it.
  `deploy-to-vercel` can upload the project to Vercel, `vercel-optimize` runs its own
  scripts, and `writing-guidelines` fetches its rules from GitHub each time it runs.
- The `skills` installer sends anonymous usage telemetry unless `DISABLE_TELEMETRY=1`
  or `DO_NOT_TRACK=1` is set.

### Testing expectations

Coverage is gated at 95% for both the project and the patch. The unit-testable surface
is `agent/lib/**` and `scripts/sign-in.ts`; the files that the eve runtime executes,
and the `pnpm connect` entry point, are excluded from coverage in both
[`vitest.config.ts`](vitest.config.ts), which lists them, and
[`codecov.yml`](codecov.yml). If you add logic worth testing, put it in `agent/lib/` so
it can be tested.

For what a tool file may import, see
[Adding tools](docs/capabilities.md#adding-tools).

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
