# Karaoke MVP — Architecture and Product Decisions

This document contains decisions that are fixed for the MVP. Reopen one only when a concrete product requirement or technical blocker is documented.

## ADR-001 — Base project

Use Karaoke Eternal as the implementation starting point and extend it instead of rewriting it.

## ADR-002 — Preserve inherited stack

Keep Node.js, TypeScript, Koa, React, Redux, Socket.IO and SQLite during the MVP.

## ADR-003 — Deployment and room scope

One deployment serves one karaoke venue. The application may retain multiple inherited rooms, but the pilot assumes one active session room and one authoritative player per room.

## ADR-004 — Online-only MVP

No offline mode is required. Local songs continue to work if YouTube is unavailable, provided the server and clients can communicate.

## ADR-005 — Participant is the scheduling identity

Fairness and pending limits use `userId`, not alias or table. `tableId` may be added later as optional metadata without affecting queue identity.

## ADR-006 — Room rules are configurable and validated

Queue rules live under `IRoomPrefs.queue`, are validated by the backend and exposed in `EditRoom`.

| Rule | Default | Range/values |
| --- | ---: | --- |
| `maxPendingPerParticipant` | `2` | integer `1..20` |
| `maxSongsPerParticipantRound` | `1` | integer `1..5` |
| `houseTracksBeforeParticipant` | `2` | integer `0..10` |
| `approvalMode` | `AUTO` | `AUTO`, `MANUAL` |
| `rotationMode` | `FAIR` | `FAIR`, `FIFO` |

Invalid or absent persisted values use their defaults. The UI and backend use the same shared schema/constants.

## ADR-007 — Pending definition

For a participant, pending count is the number of their items in `PENDING_APPROVAL` plus `APPROVED`.

`PLAYING`, `PLAYED`, `REJECTED`, `REMOVED` and `FAILED` do not count. Admin/operator-created items are exempt.

## ADR-008 — Persist request lifecycle

Persist queue item lifecycle in SQLite. The browser player's `historyJSON` is not authoritative for pending-count enforcement.

Required states:

- `PENDING_APPROVAL`
- `APPROVED`
- `PLAYING`
- `PLAYED`
- `REJECTED`
- `REMOVED`
- `FAILED`

Player-reported transitions must be idempotent.

The only recovery transition is `PLAYING -> APPROVED`, performed by the backend when the last active player leaves. Reconnect recovery must never change `PLAYED`, `FAILED`, `REJECTED` or `REMOVED` back to a pending state.

## ADR-009 — Scheduling remains in the player

Do not move the canonical upcoming-order algorithm to the backend during the MVP.

Backend owns permissions, validation, settings and lifecycle state. The active player calculates upcoming order from approved items and reports playback transitions.

## ADR-010 — Rotation modes

Support:

- `FAIR`: round-robin by participant, honoring `maxSongsPerParticipantRound`.
- `FIFO`: approved participant items by creation order.

`maxSongsPerParticipantRound` does not apply in FIFO. A settings change never replaces the current item or already locked next turn.

## ADR-011 — House interleaving

`houseTracksBeforeParticipant` is the target number of available `HOUSE` items played between participant turns.

- `0` disables automatic interleaving.
- Do not apply it before the first participant turn after playback begins.
- House tracks do not affect participant fairness or limits.
- Insufficient house items never block the participant queue.

## ADR-012 — Item origin is independent of source

Origins:

- `PARTICIPANT`
- `HOUSE`
- `OPERATOR`

Sources:

- `LOCAL`
- `YOUTUBE`

Any operator-managed house item may therefore be local or from YouTube.

## ADR-013 — Approval modes

- `AUTO`: valid participant requests start as `APPROVED`.
- `MANUAL`: valid participant requests start as `PENDING_APPROVAL`.

Changing from manual to automatic affects new requests only. Existing pending requests require an explicit operator decision.

## ADR-014 — External media representation

Do not insert YouTube results into the scanned local media library.

Queue items support source-specific references:

- Local: `localSongId` and existing media resolution.
- YouTube: `externalId` containing the video ID.

Snapshot title, artist/channel, duration and thumbnail with the queue item so history remains readable.

## ADR-015 — Song source abstraction

Introduce a small provider contract with `search` and `resolve`. Adapt the existing library as `LocalSongSource` and add `YouTubeSongSource` without rewriting the scanner/library.

## ADR-016 — Official YouTube APIs only

Use YouTube Data API for backend search/metadata and YouTube IFrame Player API for playback. Do not download, extract audio or cache media.

If an item cannot play, persist `FAILED`, notify clients and continue safely.

## ADR-017 — Backend authorization

Only admins may:

- Change room settings.
- Approve/reject requests.
- Create `HOUSE` or `OPERATOR` items.
- Reorder the queue and control playback.
- Manage another participant's items.

Participants may create and remove their own eligible requests. Backend acknowledgements are authoritative.

## ADR-018 — Single authoritative player per room

The MVP supports one authoritative player socket per room. The first admin player to publish status claims the room slot. A second player remains in visible standby, cannot independently advance lifecycle state and may claim the slot only after the authoritative player leaves.

## ADR-019 — No premature SaaS refactor

Do not introduce multi-tenancy, centralized venue management, MariaDB/PostgreSQL, Redis or microservices unless a proven blocker requires an ADR change.

## ADR-020 — One canonical implementation sequence

`docs/IMPLEMENTATION-PLAN.md` is the sole source of truth for work order. Handoff documents must reference it and must not define a conflicting sequence.
