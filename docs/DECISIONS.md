# Karaoke MVP — Decisions

## ADR-001 — Base project
Use Karaoke Eternal as the implementation starting point.

## ADR-002 — Preserve inherited stack
Keep Node.js, TypeScript, Koa, React, Redux, Socket.IO and SQLite during MVP.

## ADR-003 — Single venue instance
MVP is not multi-tenant.
One deployment serves one karaoke venue / pilot instance.

## ADR-004 — Online-only MVP
No offline mode is required.

## ADR-005 — Participant is the scheduling identity
Queue fairness is calculated by participant/singer, not by table.

## ADR-006 — Pending requests
Participants can keep requesting songs while the room is active as long as they remain below the configured pending limit.

Initial default:
maxPendingPerParticipant = 2

## ADR-007 — Fair rotation
Use round-robin style fair rotation between participants.

Initial default:
maxSongsPerParticipantRound = 1

## ADR-008 — Existing round-robin remains in frontend/player
For MVP, do not move the current Karaoke Eternal round-robin selector to the backend.

Reason:
- reduces scope
- preserves proven existing behavior
- sufficient for one room / one player pilot

Backend remains responsible for rules, permissions and limits.

## ADR-009 — Approval modes
Support:
- AUTO
- MANUAL

Default:
AUTO

## ADR-010 — House tracks
House/local venue tracks may be interleaved with participant tracks.
The number of house tracks is configurable.

Initial default:
houseTracksBeforeParticipant = 2

## ADR-011 — YouTube integration
Add YouTube as a source rather than replacing the existing local library.

Use official APIs:
- YouTube Data API
- YouTube IFrame Player API

## ADR-012 — No premature SaaS refactor
Do not introduce:
- MariaDB/PostgreSQL migration
- Redis
- microservices
- multi-tenancy
during MVP unless required by a proven blocker.
