# Codex Handoff — Karaoke MVP

This is the primary implementation entrypoint for Codex or another coding agent.

## Repository and branch

- Repository: `velnae/KaraokeEternal`.
- Working branch: `feature/karaoke-mvp`.
- Base branch: `main`.
- Upstream project: `bhj/KaraokeEternal`.

Do not implement MVP work on `main`. Determine the live ahead/behind count with Git instead of copying a potentially stale number into documentation.

## Required reading order

Read completely before changing code:

1. `docs/PRD-MVP.md` — product behavior and acceptance scenarios.
2. `docs/ARCHITECTURE.md` — domain model and responsibility boundaries.
3. `docs/DECISIONS.md` — fixed MVP decisions.
4. `docs/IMPLEMENTATION-PLAN.md` — sole authoritative work sequence.

If code and documentation conflict, do not silently redesign the product. Record the blocker and update the relevant decision/requirement before implementing a different behavior.

## Reuse-first constraint

Preserve and extend:

- rooms and room preferences;
- guest access and QR flow;
- roles and permissions;
- mobile web UI;
- Socket.IO transport;
- existing local library/scanner;
- queue UI and persistence;
- fair round-robin selector;
- CDG/MP4 player;
- SQLite migrations.

Do not introduce multi-tenancy, offline mode, Laravel, MariaDB/PostgreSQL, Redis, microservices, native apps or a backend canonical scheduler during the MVP.

## Current branch implementation state

Already present at the time of this handoff:

- Shared queue defaults, ranges, types, normalization and validation in `shared/queueRules.ts`.
- Queue Settings UI integrated into the existing room editor.
- Backend validation and normalization for room creation, update and realtime preference preview.
- Room persistence, preference socket and pending-limit tests.
- `Rooms.getPlayerStatus()`.
- SQLite queue lifecycle/source migration with metadata snapshots.
- Shared queue origin, source, status and transition rules.
- Persisted pending-count enforcement independent of player history.
- Idempotent player lifecycle synchronization and interrupted-player recovery.
- Client history reconstruction from persisted terminal states.

Not yet implemented:

- Manual approval.
- FAIR parameter/FIFO selection.
- House/operator items.
- Song-source abstraction.
- YouTube search/playback.
- Business-rule tests.

Always inspect the current diff because this section may become stale as implementation advances.

## First task

Start at the first incomplete phase in `docs/IMPLEMENTATION-PLAN.md`. Phases 0 through 2 are implemented. Review `docs/BASELINE.md`, confirm the working tree and verification results, then continue with Phase 3.

## Non-negotiable behavioral rules

- Participant identity is `userId`.
- Pending means `PENDING_APPROVAL` plus `APPROVED`.
- Lifecycle state is persisted; `historyJSON` is not authoritative for limits.
- `FAIR` stays in the frontend/player and supports configurable songs per turn.
- `FIFO` uses approved creation order.
- House availability never blocks participant playback.
- YouTube stays separate from the scanned local library.
- Only official YouTube APIs are used.
- One authoritative player is supported per room.
- New business rules require tests.

## Completion protocol for each phase

For every phase:

1. List files changed.
2. Describe schema/API/UI behavior added.
3. List automated tests added.
4. Report lint, typecheck, test and build results.
5. Call out inherited failures separately.
6. Confirm exit criteria before starting the next phase.
