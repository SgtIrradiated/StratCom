# 0008. AGPL-3.0-or-later for code

- **Status:** Accepted
- **Date:** 2026-10-05

## Context

The project is to be open source and is primarily distributed as a **hosted web game**.
Under the ordinary GPL, someone could run a modified StratCom on their own server without
sharing their changes, because serving a web page is not "distribution". Beyond All Reason
and its engine are GPL-licensed.

## Decision

All code is licensed **AGPL-3.0-or-later** (`LICENSE`). The AGPL's network clause requires
anyone who lets users play a modified version over a network to offer those users the
modified source.

Art, audio and map assets will get a separate license (likely CC BY-SA 4.0) when real assets
arrive.

## Consequences

- Forks that run public servers must stay open.
- Dependencies must be AGPL-compatible. MIT, BSD, Apache-2.0, ISC, MPL-2.0 and (L)GPL-3.0
  are all fine. Check the license before adding a dependency.
- The hosted game should link to its source code (to be added to the main menu credits in M3).
- While the project owner is the sole copyright holder, the license can still be changed.
  Once outside contributions arrive, that requires contributor agreement.
