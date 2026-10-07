# 0003. Deterministic lockstep networking

- **Status:** Accepted (implementation in M8)
- **Date:** 2026-10-05

## Context

Supreme Commander/BAR-scale games have thousands of units. Sending authoritative state would
cost far more bandwidth than a browser connection can handle. Both reference games use
deterministic lockstep.

## Decision

- Clients send only **commands**. A relay on our server orders them into **turns** (2 ticks,
  100 ms; ADR-0007) and broadcasts each turn to all clients.
- Each client runs the full simulation (ADR-0002). Local input is scheduled a few turns ahead
  (adaptive input delay based on measured round-trip time).
- If a turn hasn't arrived, the client pauses the simulation but keeps rendering.
- Periodic state hashes detect desyncs.
- A replay is the match setup plus the turn log.
- The server does not run the simulation during a match, but because the simulation is pure
  TypeScript it can run it headlessly to validate replays or results.

## Consequences

- Bandwidth is independent of unit count, and replays are tiny.
- Input latency is at least one turn. The UI must acknowledge orders instantly (sounds,
  markers) to feel responsive.
- Any non-determinism is fatal. That is why ADR-0002 is strict.
- Maphacks are possible, because every client has full state. This is an accepted trade-off
  for this genre.
- Commands must be serializable from day one, even before M8.
