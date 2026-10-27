# Architecture Decision Records

An ADR records a significant decision, the context that led to it, and its consequences.
ADRs are **immutable once accepted**. To change a decision, write a new ADR that supersedes the
old one, and update the old one's status line.

| #                                              | Title                                       | Status                          |
| ---------------------------------------------- | ------------------------------------------- | ------------------------------- |
| [0001](0001-monorepo-and-tooling.md)           | Monorepo and tooling                        | Accepted                        |
| [0002](0002-deterministic-float-simulation.md) | Deterministic floating-point simulation     | Accepted                        |
| [0003](0003-lockstep-networking.md)            | Deterministic lockstep networking           | Accepted (implementation in M8) |
| [0004](0004-threejs-renderer-boundary.md)      | three.js behind a renderer boundary         | Accepted                        |
| [0005](0005-custom-soa-ecs.md)                 | Custom structure-of-arrays ECS              | Accepted (implemented in M1)    |
| [0006](0006-data-driven-content.md)            | Data-driven content validated with zod      | Accepted                        |
| [0007](0007-simulation-tick-rate.md)           | 20 Hz simulation tick, 2-tick network turns | Accepted                        |
| [0008](0008-license.md)                        | AGPL-3.0-or-later for code                  | Accepted                        |

## Writing a new ADR

Copy the template below into `NNNN-short-title.md` (next free number), fill it in, add it to
the table above, and open a PR. Keep it to about a page.

```markdown
# NNNN. Title

- **Status:** Proposed | Accepted | Superseded by [NNNN](NNNN-….md)
- **Date:** YYYY-MM-DD

## Context

What problem are we solving? What constraints and forces apply?

## Decision

What we decided, stated plainly.

## Consequences

What becomes easier, what becomes harder, and what we must now do or watch for.
```
