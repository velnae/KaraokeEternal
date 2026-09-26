# Karaoke MVP — Implementation Plan

## Goal
Extend Karaoke Eternal with the minimum code necessary to demonstrate the complete karaoke venue flow.

## Phase 0 — Baseline
- Fork Karaoke Eternal.
- Create feature branch.
- Install dependencies.
- Run current tests.
- Run typecheck/build.
- Verify existing room, QR, queue and player behavior before modifying code.

## Phase 1 — Configuration
Extend room preferences with:
- maxPendingPerParticipant
- maxSongsPerParticipantRound
- houseTracksBeforeParticipant
- approvalMode
- rotationMode

Do not redesign room persistence.

## Phase 2 — Backend request validation
Modify queue add flow so backend:
- counts participant pending requests
- rejects requests beyond the configured limit
- validates room state and permissions
- respects AUTO / MANUAL mode

Primary area:
- server/Queue/
- server/Rooms/

## Phase 3 — Song source abstraction
Create a minimal abstraction for external/local song providers.

Suggested structure:
server/SongSource/
- SongSource.ts
- LocalSongSource.ts
- YouTubeSongSource.ts

Do not rewrite the existing local library.

## Phase 4 — YouTube search
Add backend endpoint/socket action for YouTube search.
Use the YouTube Data API.

Frontend:
- extend library/search UI
- display YouTube search results
- allow result to become a queue request

## Phase 5 — YouTube playback
Create:
- YouTubePlayer component

Extend current player selection:
- cdg -> CDGPlayer
- mp4 -> MP4Player
- youtube -> YouTubePlayer

Use YouTube IFrame Player API.

## Phase 6 — House tracks
Add an explicit origin/type for queued content:
- PARTICIPANT
- HOUSE
- OPERATOR

Implement the minimum interleaving required for:
houseTracksBeforeParticipant

Prefer extending current queue behavior rather than introducing a full canonical scheduler.

## Phase 7 — Operator controls
Ensure operator can:
- approve/reject when MANUAL mode is active
- remove queue entries
- move entries
- pause
- resume
- skip

Reuse current controls wherever possible.

## Phase 8 — End-to-end pilot
Acceptance flow:
1. Operator creates/opens room.
2. QR is displayed.
3. Participant joins as guest.
4. Participant searches YouTube.
5. Participant requests a track.
6. Backend enforces pending limit.
7. Multiple participants are fairly rotated.
8. House tracks can be interleaved.
9. Main player reproduces selected content.
10. Operator can intervene.

## Important constraints for Codex
- Do not migrate stack.
- Do not introduce multi-tenancy.
- Do not move round-robin to backend in MVP.
- Do not replace working Karaoke Eternal features unnecessarily.
- Prefer extension over rewrite.
- Add tests for every new business rule.
