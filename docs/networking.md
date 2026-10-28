# Networking (draft)

Drafted in M2 so that commands are serialisable from the start. The implementation (the
`@stratcom/protocol` package, lobby and relay) lands in M8; see
[ADR-0003](adr/0003-lockstep-networking.md) for the decision and [PLAN.md §6.4](PLAN.md) for
the protocol sketch.

## Model

Deterministic lockstep: every client runs the same `Simulation` and exchanges **only player
commands**. Because the simulation is a pure function of `(MatchSetup, ordered commands)`
([ADR-0002](adr/0002-deterministic-float-simulation.md)), identical inputs give identical
state on every peer.

- A **turn** covers 2 ticks (100 ms, [ADR-0007](adr/0007-simulation-tick-rate.md)).
- Each client sends the commands it issued for turn `T + inputDelay`; the server relays the
  full, ordered set for each turn to everyone.
- A client advances turn `T` only when it holds every player's commands for it.
- Every N turns each client sends `stateHash()`; the server compares them and reports a
  desync with a state dump if they differ.

## Command rules (what M2 already guarantees)

`PlayerCommand` (`packages/sim/src/commands.ts`) is plain JSON-serialisable data:

- Only numbers, strings and arrays of numbers; no class instances, `Map`s or typed arrays.
- Entities are referred to by `EntityId` (generation-checked `u32`), never by array index, so a
  stale id is detected and ignored identically on every peer.
- Every command carries the issuing `slot`. The relay stamps the slot from the connection
  and the simulation re-checks unit ownership, so a client cannot command units it does not
  own.
- Validation is part of the simulation: malformed, out-of-range, non-finite or unauthorised
  commands are **no-ops on every peer**. Nothing outside the simulation decides what is
  legal.
- Commands within a turn are applied in a canonical order (by slot, then submission order),
  chosen by the server.

Current commands (M5): `move { units, to }`, `stop { units }`,
`build { units, unitType, at, facing }`, `reclaim { units, target }`,
`assist { units, target }`, `attack { units, target }`, `produce { units, unitType, count }`
and `rally { units, to }`, each with the issuing `slot`. `move`, `build`, `reclaim`,
`assist` and `attack` take `queue: true` to
append to the order queue instead of replacing it. Attack and the rest arrive with their
milestones.

- Build sites travel as the requested point; every peer snaps them with the same pure
  `placement.ts` rules, and placement is re-checked when the builder arrives, so a site that
  became blocked fails identically everywhere.
- Commands are never rejected for affordability: the flow economy charges as work happens
  (ADR-0010), so there is no "can I afford it" race between peers.

## Match setup (from M3)

Lobby settings become a `MatchSetup` through `createSkirmishSetup({ seed, map, ruleset,
players })` in `@stratcom/sim`, a pure function. Peers therefore exchange only the settings
(map id, seed, the slot list), never terrain or unit lists, and derive identical setups.

- The slot model (`apps/client/src/game/skirmishConfig.ts`) is what the online lobby will
  edit: `{ kind: human | ai | open | closed, factionId, team, color }` per start position.
  Only `human` and `ai` slots become players; slot numbers are kept, so slot 3 always starts
  at the map's fourth start position.
- The join handshake must compare `RULESET.hash` ([ADR-0009](adr/0009-ruleset-compiler-and-hash.md))
  together with the protocol version. Any content difference, even a renamed unit, changes
  the hash.
- AI slots are virtual players that issue ordinary commands (M6, runtime in M6.1). Their commands travel
  like a human's, so peers need nothing AI-specific; which peer runs them is an open
  question below.

## What is deliberately not networked

- **Camera, selection and control groups** are local UI state. Only the resulting command
  (`move` with explicit unit ids) crosses the network.
- **Snapshots** are a local sim→renderer channel and never leave the machine.
- **The flow fields** used for pathfinding are derived state, recomputed on every peer from
  `(terrain, goal)`; they are never transmitted.

## Open questions for M8

- Binary codec (a compact `Uint8Array` format) versus JSON for turns. JSON is fine to start.
- Adaptive input delay: measured from round-trip time, with a floor of one turn.
- Late join and reconnect: replay the turn log from tick 0 versus a state snapshot transfer.
  Replay from the turn log is already required for replays, so it is the default.
- Which peer runs the AI slots, and who takes over if that peer leaves.
