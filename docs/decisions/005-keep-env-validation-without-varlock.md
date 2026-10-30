# ADR-005: Keep adam's own environment validation rather than adopt Varlock

## Status

Accepted

## Date

2026-10-01

## Context

adam documents its variables in `env.example` and validates them with a zod schema in
`agent/lib/env.ts`, tested in `agent/lib/env.test.ts`, which fails the build and startup
on an incomplete environment. [Varlock](https://varlock.dev/) was proposed instead: a
committed `.env.schema` declaring each variable's type and sensitivity, with
validation, generated types, log redaction, and plugins that fetch values from a secret
store, so local keys could come from a secret manager rather than `.env.local`.

## Decision

Not now. Keep `agent/lib/env.ts` and `env.example`. A contributor who keeps secrets in
a secret manager injects them into the process environment when starting adam, which is
where adam already reads them; that needs no change to the repository.

## Alternatives Considered

### Adopt Varlock as the committed schema

- Pros: log redaction and generated types, which adam lacks.
- Cons: it replaces a tested schema and file that already do the rest, adds a tool
  every fork must learn, and is untested inside `eve build` and on Vercel. Neither
  Vercel's template form nor its Deploy button reads a schema.
- Cons: the secret-store plugin evaluated requires `@disableProcessEnvInjection`, so
  secrets never reach `process.env`. adam and its libraries, such as Upstash's
  `Redis.fromEnv()`, read `process.env`, so every secret would have to be passed
  explicitly in committed code, making Varlock a runtime dependency of every fork.
- Rejected: one contributor's local secret handling would reshape the public starter.

## Consequences

- Nothing changes in the repository, and adam keeps matching the featured eve starters,
  none of which use an environment library.
- If Varlock is revisited, write its schema once, after the variable list is settled,
  and supersede this record.
