# Codex Handoff — Karaoke MVP

This is the primary entrypoint for continuing the Karaoke MVP implementation in Codex.

## Repository and branch

- Repository: `velnae/KaraokeEternal`
- Working branch: `feature/karaoke-mvp`
- Base branch: `main`
- Do not switch back to `main` for implementation work.

At the time of this handoff, `feature/karaoke-mvp` is 9 commits ahead of `main` and 0 commits behind.

## Read these documents first, in this order

1. `docs/ARCHITECTURE.md`
2. `docs/PRD-MVP.md`
3. `docs/DECISIONS.md`
4. `docs/IMPLEMENTATION-PLAN.md`

These documents define the intended architecture, product scope, fixed decisions, and implementation sequence. Do not reopen documented decisions unless a concrete technical blocker is found.

## Current implementation state

Documentation already added:

- `docs/ARCHITECTURE.md`
- `docs/PRD-MVP.md`
- `docs/DECISIONS.md`
- `docs/IMPLEMENTATION-PLAN.md`

Code already changed:

- `shared/types.ts`
  - Added `IRoomPrefs.queue` with:
    - `maxPendingPerParticipant`
    - `maxSongsPerParticipantRound`
    - `houseTracksBeforeParticipant`
    - `approvalMode: 'AUTO' | 'MANUAL'`
    - `rotationMode: 'FAIR' | 'FIFO'`

- `server/Rooms/Rooms.ts`
  - Added `Rooms.getPlayerStatus(io, roomId)`.
  - `Rooms.isPlayerPresent()` now reuses that method.

- `server/Queue/socket.ts`
  - Added backend validation for `maxPendingPerParticipant`.
  - Default is `2` when no valid room preference is configured.
  - Admin users are not restricted by this limit.
  - Pending count excludes queue items already present in the player's `historyJSON` and excludes the currently playing `queueId`.
  - This intentionally reuses the existing player state instead of creating a new canonical scheduler in the backend.

## Important architectural constraint

For the MVP, keep Karaoke Eternal's existing round-robin/fair ordering in the frontend/player.

Do **not** move round-robin scheduling to the backend during this MVP unless an actual blocker is demonstrated.

Backend responsibilities for MVP:

- permissions
- validation
- participant limits
- room configuration
- approval rules

Frontend/player responsibilities for MVP:

- existing fair round-robin ordering
- selecting the next item using existing Karaoke Eternal behavior
- playback

## Current code has NOT been validated yet

The changes above were written through GitHub but have not yet been executed in a development environment.

Before adding more functionality, establish the baseline using the project's required versions:

- Node.js `>=24`
- npm `>=11`

Then run:

```bash
npm install
npm run lint
npm run typecheck
npm test
npm run build
```

If the repository has a valid lockfile suitable for the environment, prefer `npm ci` over `npm install`.

### First Codex task

1. Check out `feature/karaoke-mvp`.
2. Read all four documents listed above.
3. Review the current diff against `main`.
4. Run lint, typecheck, tests and build.
5. Fix only regressions or type/test/build failures introduced by the current MVP changes.
6. Do not expand scope while stabilizing the baseline.
7. Report the exact baseline results before continuing to the next feature.

## Next feature after baseline is green

Implement the room-level **Queue Settings** UI by extending the existing room preferences mechanism used by `EditRoom`.

Expose at least:

- Maximum pending requests per participant
- Maximum songs per participant round
- House tracks before participant track(s)
- Approval mode: `AUTO` / `MANUAL`
- Rotation mode: `FAIR` / `FIFO`

Prefer extending the existing room preferences UI and persistence path. Do not create a new settings subsystem.

After Queue Settings is working and tested, continue in the sequence defined in `docs/IMPLEMENTATION-PLAN.md`:

1. Approval mode behavior
2. House-track behavior
3. YouTube source/search integration
4. YouTube player integration
5. End-to-end pilot flow

## Explicit MVP exclusions

Do not introduce these during MVP unless required by a proven blocker:

- multi-tenancy
- offline mode
- Laravel
- MariaDB/PostgreSQL migration
- Redis
- microservices
- native Android/iOS apps
- backend rewrite of the round-robin scheduler

## Implementation principle

Extend Karaoke Eternal with the smallest practical set of changes required for the MVP. Reuse existing rooms, guest users, QR flow, Socket.IO, queue UI, player and SQLite persistence wherever possible.

When a current implementation can be extended safely, prefer that over replacing it.