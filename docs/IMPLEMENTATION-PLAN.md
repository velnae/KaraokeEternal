# Karaoke MVP — Implementation Plan

## 1. Goal

Extend Karaoke Eternal with the minimum coherent set of changes required for an in-venue pilot. Each phase must preserve the existing local karaoke flow and leave the repository in a testable state.

This file is the only authoritative implementation sequence. `HANDOFF.md` and `CODEX-HANDOFF.md` reference this plan rather than maintaining alternative priorities.

## Current progress

- Phase 0: completed on 2026-09-26. See `docs/BASELINE.md`.
- Phase 1: completed in commit `2cba71f9`.
- Phase 2: completed in commit `125c0092`.
- Phase 3: completed in commit `8fa984d8`.
- Phase 4: completed on 2026-09-26.
- Phase 5: completed on 2026-09-26.
- Phase 6: completed on 2026-09-27.
- Next phase: Phase 7 — YouTube search and request creation.

## 2. Delivery rules

- Work only on `feature/karaoke-mvp` unless explicitly instructed otherwise.
- Prefer extension over replacement.
- Do not migrate the inherited stack.
- Add a SQLite migration for every persisted schema change.
- Share defaults, enums and validation rules between frontend/backend when practical.
- Add automated tests for every business rule.
- Run lint, typecheck, tests and build after each phase.
- Separate inherited baseline failures from regressions introduced by the branch.
- Do not continue to the next phase with a new failing test/typecheck/build error.

## Phase 0 — Establish and stabilize baseline

### Tasks

1. Compare the branch with `main`.
2. Install with Node.js 24+ and npm 11+.
3. Run:

   ```bash
   npm ci
   npm run lint
   npm run typecheck
   npm test
   npm run build
   ```

4. Record which failures also exist on `main`.
5. Fix regressions introduced by current MVP commits before adding features.
6. Add focused tests for the existing pending-limit behavior or replace it in Phase 2 without losing coverage.

### Exit criteria

- Baseline results are documented.
- No unclassified branch regression remains.
- Existing local room, QR, queue and player flow is manually smoke-tested.

## Phase 1 — Shared queue settings and room UI

### Tasks

1. Define shared defaults, enums and ranges:
   - `maxPendingPerParticipant`: `1..20`, default `2`.
   - `maxSongsPerParticipantRound`: `1..5`, default `1`.
   - `houseTracksBeforeParticipant`: `0..10`, default `2`.
   - `approvalMode`: `AUTO | MANUAL`, default `AUTO`.
   - `rotationMode`: `FAIR | FIFO`, default `FAIR`.
2. Normalize missing/invalid persisted preferences on the backend.
3. Add Queue Settings to existing `EditRoom` preferences.
4. Reuse the existing preferences persistence and realtime push path.
5. Show inline validation and effective defaults.

### Tests

- Default normalization.
- Minimum/maximum accepted values.
- Rejection of invalid numbers/enums.
- Persistence and retrieval per room.

### Exit criteria

- Operator can edit all five settings.
- Refreshing the room editor preserves values.
- Connected clients receive updated preferences.

## Phase 2 — Queue item model and persistent lifecycle

### Tasks

1. Add shared enums/types for:
   - origin: `PARTICIPANT | HOUSE | OPERATOR`.
   - source: `LOCAL | YOUTUBE`.
   - status: `PENDING_APPROVAL | APPROVED | PLAYING | PLAYED | REJECTED | REMOVED | FAILED`.
2. Add a forward SQLite migration for lifecycle/source fields and metadata snapshots.
3. Preserve existing local queue rows by migrating them to:
   - origin `PARTICIPANT`.
   - source `LOCAL`.
   - status derived conservatively as `APPROVED` unless reliable played state exists.
4. Allow local items to resolve through existing song/media tables.
5. Prepare nullable external reference fields without implementing YouTube search yet.
6. Make lifecycle transition commands idempotent and backend-authorized.
7. Change pending count to use persisted statuses instead of player `historyJSON`.

### Tests

- Database migration with existing queue rows.
- Allowed and forbidden lifecycle transitions.
- Idempotent repeated transition.
- Pending count for every status.
- Admin/operator exemption.
- Player reconnect does not revive played items.

### Exit criteria

- Played state survives refresh/reconnect.
- Pending enforcement no longer depends on an active player socket.
- Existing local playback still works.

## Phase 3 — Automatic and manual approval

### Tasks

1. Create participant items as `APPROVED` in `AUTO`.
2. Create participant items as `PENDING_APPROVAL` in `MANUAL`.
3. Add admin-only approve/reject Socket.IO actions.
4. Add operator pending-request view/filter.
5. Show request status to its participant in realtime.
6. Ensure changing approval mode affects new requests only.

### Tests

- AUTO initial state.
- MANUAL initial state.
- Non-admin approval/rejection denied.
- Approved item becomes eligible.
- Rejected item never becomes eligible.
- Mode change does not auto-approve existing pending items.

### Exit criteria

- Both approval modes pass an end-to-end local-song scenario.

## Phase 4 — Configurable participant ordering

### Tasks

1. Preserve the existing round-robin selector as the FAIR foundation.
2. Extend FAIR to support `maxSongsPerParticipantRound` from 1 through 5.
3. Add FIFO ordering for approved participant items.
4. Preserve per-participant request order in FAIR.
5. Do not replace the current or already locked next turn after a setting/queue change.
6. Exclude non-approved and non-participant items from participant rotation calculations.

### Tests

- FAIR with one and multiple songs per turn.
- FIFO creation order.
- Late participant behavior.
- Locked-next behavior.
- Mode change affects only subsequent items.

### Exit criteria

- Deterministic selectors cover all documented ordering examples.
- No backend canonical scheduler is introduced.

## Phase 5 — House and operator items

### Tasks

1. Allow admins to create items with origin `HOUSE` or `OPERATOR` from local songs.
2. Maintain an approved house-item pool/ordering using the existing queue persistence where practical.
3. Interleave up to `houseTracksBeforeParticipant` available house items between participant turns.
4. Never block participants when the configured number is unavailable.
5. Skip house insertion before the first participant turn and while there are no participant requests.
6. Keep operator items manually positioned and outside participant fairness history.
7. Show origin badges/labels in operator queue UI.

### Tests

- Value 0 disables interleaving.
- Exact, fewer and excess house items.
- First participant has no preceding automatic house insertion.
- House items do not change participant turn history.
- Operator item ordering and permissions.

### Exit criteria

- Complete local-only pilot works with participant, house and operator items.

## Phase 6 — Song source abstraction

### Tasks

1. Add minimal normalized contracts:

   ```text
   SongSource.search(query, roomContext)
   SongSource.resolve(id, roomContext)
   ```

2. Implement `LocalSongSource` as an adapter over the existing library.
3. Normalize source, ID, title, artist/channel, duration, thumbnail and playability.
4. Do not rewrite the scanner or duplicate local song persistence.
5. Update queue creation to accept a normalized resolved song.

### Tests

- Local search/resolve adapter.
- Source invariants.
- Metadata snapshot creation.
- Existing library behavior remains intact.

### Exit criteria

- Local requests use the normalized source boundary with no user-visible regression.

## Phase 7 — YouTube search and request creation

### Tasks

1. Add backend-only YouTube API configuration.
2. Implement `YouTubeSongSource` with YouTube Data API.
3. Add backend endpoint/socket action for search.
4. Resolve selected videos and validate embeddability/playability when available.
5. Extend search UI to distinguish Local and YouTube results.
6. Create queue items with source `YOUTUBE`, video ID and metadata snapshot.
7. Add loading, no-results, quota and API-error states.
8. Keep local search usable when YouTube is unconfigured or unavailable.

### Tests

- Mocked YouTube search and resolution.
- API key never returned to client.
- Non-embeddable/unresolvable result rejected.
- Quota/API failure isolation.
- YouTube item persistence without local library insertion.

### Exit criteria

- Participant can request a YouTube result through AUTO and MANUAL flows.

## Phase 8 — YouTube playback

### Tasks

1. Create `YouTubePlayer` using IFrame Player API.
2. Extend player selection:
   - local CDG -> `CDGPlayer`.
   - local MP4 -> `MP4Player`.
   - YouTube -> `YouTubePlayer`.
3. Support load, play, pause, resume, end and error callbacks.
4. On unplayable/removed video, persist `FAILED`, notify clients and continue safely.
5. Preserve browser autoplay startup guidance.

### Tests

- Player selection by source/media type.
- YouTube end advances once.
- Error marks failed and advances once.
- Repeated callbacks remain idempotent.

### Exit criteria

- Mixed local/YouTube queue plays without manual state repair.

## Phase 9 — Operator UX and authorization audit

### Tasks

1. Verify approve/reject, remove, move/make-next, pause, resume, skip and replay.
2. Audit backend authorization for every mutating action.
3. Handle a second player attempt explicitly.
4. Improve source/origin/status visibility.
5. Confirm optimistic actions roll back on rejection.

### Exit criteria

- Participant cannot perform operator-only actions.
- Operator can recover from failed items without database intervention.

## Phase 10 — End-to-end pilot validation

Validate at least:

1. Local-only room with AUTO + FAIR.
2. Local-only room with MANUAL + FIFO.
3. Configurable multiple songs per participant turn.
4. House count `0`, partial availability and full availability.
5. Mixed CDG, MP4 and YouTube playback.
6. Participant pending-limit recovery after a track begins.
7. Player refresh/reconnect.
8. Closed room rejects new requests while existing playback can finish.
9. YouTube outage/quota error does not break local functionality.
10. Mobile participant plus desktop operator/player pilot.

### Final completion criteria

- Lint, typecheck, tests and build have no MVP regressions.
- All acceptance scenarios in `PRD-MVP.md` pass.
- Database migration is tested with a pre-MVP database copy.
- Setup/configuration changes are documented.
- Explicit exclusions remain excluded.
