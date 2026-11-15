# Decision records

Each file here records one significant decision about adam: the context that forced it,
what was decided, the alternatives considered and why they lost, and what follows from
it. Code shows what adam does; these records keep why it is that way, so a contributor
can tell a deliberate choice from an accident before changing it.

## What earns a record

A decision that would be expensive to reverse or that a fork would otherwise
re-litigate: a framework, provider or major dependency, how callers authenticate, what
the template ships to every fork, or a deliberate "not now" on a proposed tool. Small
calls that serve a larger decision belong inside that decision's record, not in a record
of their own. Routine dependency updates and wording fixes do not get one.

## Records

| Record                                                 | Decision                                                         | Status   |
| ------------------------------------------------------ | ---------------------------------------------------------------- | -------- |
| [ADR-001](001-route-the-model-through-ai-gateway.md)   | Route the model through Vercel AI Gateway                        | Accepted |
| [ADR-002](002-opt-in-anonymous-access.md)              | Open access to anonymous callers only as an opt-in setting       | Accepted |
| [ADR-003](003-sign-in-with-vercel.md)                  | Use Sign in with Vercel as the sign-in provider                  | Accepted |
| [ADR-004](004-commit-agent-tooling-without-secrets.md) | Commit agent tooling that needs no secret, and nothing that does | Accepted |
| [ADR-005](005-keep-env-validation-without-varlock.md)  | Keep adam's own environment validation rather than adopt Varlock | Accepted |

## Writing one

- **File:** `NNN-short-title.md`, numbered in sequence from the highest existing record.
  Numbers are never reused.
- **Heading:** `# ADR-NNN: <the decision, as an imperative>`.
- **Sections, in this order:** Status, Date, Context, Decision, Alternatives Considered
  (one `###` per alternative, ending with why it was rejected), Consequences. A few
  sentences each.
- **Date:** the day the decision was made, not the day the record was written.
- **Sources:** cite what a reader can open: files in this repository, its pull requests
  and commits, vendor documentation, upstream issues.
- Propose a record in the pull request that makes the change it describes, or on its own
  if the decision comes first. It goes through review like any other change; see
  [GOVERNANCE.md](../../GOVERNANCE.md).

## Statuses

`Proposed`, then `Accepted`; later `Superseded by ADR-NNN` or `Deprecated`.

A record is never deleted or rewritten to say something new. When a decision changes,
write a new record that states what it replaces, and change only the old record's
status to `Superseded by ADR-NNN`. A decision dropped with nothing in its place becomes
`Deprecated`, with one line saying why.
