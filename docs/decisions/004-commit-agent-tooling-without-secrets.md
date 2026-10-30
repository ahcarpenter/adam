# ADR-004: Commit agent tooling that needs no secret, and nothing that does

## Status

Accepted

## Date

2026-10-01

## Context

https://github.com/ahcarpenter/adam/pull/35 committed `.mcp.json` with Vercel's hosted
MCP server, which none of Vercel's featured eve starters carry. Coding agents working
on adam were also to get MCP servers for its other providers, Vercel's plugin, and
Vercel's agent skills. Anything committed here ships to every fork of the template, and
one of those providers, Upstash, authenticates its MCP server only with an API key.

## Decision

- Keep `.mcp.json`, holding the hosted servers that sign in through the browser:
  Vercel, Braintrust and PostHog, at their generic endpoints.
- Leave Upstash's MCP server out of the repository; a contributor adds it to their own
  local config with their own key.
- Enable Vercel's plugin in `.claude/settings.json`.
- Vendor three of Vercel's agent skills into `.claude/skills/`, recorded in
  `skills-lock.json`: `deploy-to-vercel`, `vercel-optimize` and `writing-guidelines`.
  None go in `agent/skills/`, so none ship in the deployed agent.

Shipped in https://github.com/ahcarpenter/adam/pull/41.

## Alternatives Considered

### Remove `.mcp.json`

- Pros: matches the featured starters exactly.
- Rejected: it costs the convenience the file gives, and no published bar asks for it
  to go.

### Commit the MCP servers, install the plugin and skills per machine

- Pros: the repository stays closer to the featured starters.
- Rejected: contributors and forks would each set them up by hand.

### Install everything per machine

- Rejected: forks would get none of the tooling for the providers adam already uses.

### Every skill in `vercel-labs/agent-skills`, with or without `vercel-cli-with-tokens`

- Rejected: the other skills target React, React Native or web UI, which a headless
  agent has none of, and `vercel-cli-with-tokens` has an agent read a token out of
  `.env` files.

## Consequences

- Nothing secret is committed, and a server that needs a key never belongs in
  `.mcp.json`.
- Every fresh clone asks to approve each server; the plugin's telemetry is on by default
  with a documented opt-out.
- The skills are upstream copies, excluded from formatting, and must be refreshed with
  `--agent claude-code` or the installer writes them into `agent/skills/`. See
  [Agent tooling](../../CONTRIBUTING.md#agent-tooling).
