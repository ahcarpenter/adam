# Governance

This document describes who decides what in this project, and how.

## Decision making

Decisions about direction, features, and significant changes are made in public — in
issues and pull requests on this repository. There is no private channel where the real
discussion happens.

The project currently has a single maintainer, who makes the final call when there is no
consensus. That is stated plainly rather than dressed up as a committee: with one
maintainer, "consensus" and "the maintainer agreed" are the same event. As the project
grows more maintainers, this document changes with it.

Disagreement is welcome and is expected to be argued in the open. A decision that cannot
be explained is a decision that should be revisited.

## Roles

### Maintainers

Current maintainers are listed in [.github/CODEOWNERS](.github/CODEOWNERS).

Maintainers are responsible for:

- Reviewing and merging contributions.
- Setting project goals and priorities.
- Cutting releases and maintaining the [changelog](CHANGELOG.md).
- Responding to security reports (see [SECURITY.md](SECURITY.md)).
- Upholding the [Code of Conduct](CODE_OF_CONDUCT.md), including resolving conflicts
  within the community.

Maintainers are added on the basis of sustained, high-quality contribution and
demonstrated judgment about the project's goals — not on volume of commits. An existing
maintainer proposes the addition; existing maintainers must agree. A maintainer may step
down at any time, and one who has been inactive for an extended period may be moved to
emeritus.

### Contributors

Anyone who opens an issue, improves the documentation, reports a bug, or sends a pull
request. No formal process, no permission needed. See
[CONTRIBUTING.md](CONTRIBUTING.md).

## Scope

This repository is a starter template for [eve](https://eve.dev) agents. Changes are
evaluated against that purpose: does this make the skeleton clearer, safer, or easier to
fork? Domain-specific features generally belong in a fork rather than here, and will be
declined with that reasoning.

## Changing this document

Amendments go through a pull request, like everything else.
