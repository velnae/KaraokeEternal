# Karaoke MVP — Codex Handoff

## Purpose
This document is the entry point for continuing implementation of the karaoke MVP on top of Karaoke Eternal.

Before changing code, read:

1. `docs/ARCHITECTURE.md`
2. `docs/PRD-MVP.md`
3. `docs/DECISIONS.md`
4. `docs/IMPLEMENTATION-PLAN.md`

## Repository and branch
- Repository: `velnae/KaraokeEternal`
- Working branch: `feature/karaoke-mvp`
- Upstream/base project: `bhj/KaraokeEternal`

## Product direction
The MVP is a single-venue karaoke system where customers join from their phones through a QR code, search karaoke tracks, request songs and enter a fair queue. The main karaoke PC runs the player and sends video to the venue TVs through the venue's existing HDMI/display setup.

The MVP is intentionally **not multi-tenant** and **not offline-first**.

## Reuse-first principle
Do not rewrite working Karaoke Eternal functionality unless a concrete blocker requires it.

Prefer to reuse:
- rooms
- guest access
- QR access
- roles
- mobile web UI
- Socket.IO realtime transport
- queue UI
- browser player
- SQLite persistence
- local media library

## Stack to preserve for MVP
- Node.js >= 24
- npm >= 11
- TypeScript
- Koa
- React
- Redux / Redux Toolkit
- Socket.IO
- SQLite
- Vitest
- Webpack

Do not migrate to Laravel, MariaDB/PostgreSQL, Redis, microservices or another frontend stack during the MVP.

## Queue model
The current Karaoke Eternal fair round-robin algorithm stays in the frontend/player for the MVP.

Do **not** move the canonical rotation algorithm to the backend yet.

Backend responsibilities:
- validate room state
- validate permissions
- enforce participant request limits
- persist queue/request state
- broadcast changes

Frontend/player responsibilities:
- use the existing round-robin calculation
- determine the fair upcoming playback order
- control media playback

## Initial room rules
These values must be configurable per room.

Defaults:
- `maxPendingPerParticipant = 2`
- `maxSongsPerParticipantRound = 1`
- `houseTracksBeforeParticipant = 2`
- `approvalMode = 'AUTO'`
- `rotationMode = 'FAIR'`

Participants may continue adding songs during an active session whenever they are below the pending-request limit.

The participant/singer is the scheduling identity. A table is not the primary queue identity.

## Approval
Support:
- `AUTO`: valid requests enter the queue immediately.
- `MANUAL`: requests require operator approval.

Default is `AUTO`.

## Track origins
The implementation must be able to distinguish at least:
- `PARTICIPANT`
- `HOUSE`
- `OPERATOR`

House tracks are venue-selected tracks that can be interleaved with participant requests according to room configuration.

## Song sources
Keep the existing local media library.

Add YouTube as another source rather than replacing local media.

Target abstraction:

```text
SongSource
├── LocalSongSource
└── YouTubeSongSource
```

YouTube integration:
- search: YouTube Data API
- playback: YouTube IFrame Player API

Do not implement downloading, audio extraction or offline caching of YouTube media.

## Player extension
Keep existing:
- CDG player
- MP4 player

Add:
- YouTube player

Conceptually:

```text
mediaType=cdg      -> CDGPlayer
mediaType=mp4      -> MP4Player
mediaType=youtube  -> YouTubePlayer
```

## MVP acceptance flow
A complete pilot is successful when:

1. Operator opens a room.
2. QR is displayed.
3. Customer scans QR and joins as guest with an alias.
4. Customer searches for a karaoke track.
5. Customer submits a request.
6. Backend rejects the request if the participant is already at the configured pending limit.
7. Multiple participants are fairly rotated using the existing round-robin behavior.
8. Venue/house tracks can be interleaved according to configuration.
9. The main PC player reproduces the selected track.
10. Operator can pause, resume, skip, remove and manage requests.
11. Manual approval can be enabled when configured.

## Explicitly out of scope
Do not add during this MVP:
- SaaS multi-tenancy
- centralized multi-venue management
- offline mode
- native Android/iOS applications
- payments
- reservations
- WhatsApp login
- singer scoring
- microphone/audio analysis
- AI singer evaluation

## Development baseline
Before functional modifications are considered complete, use the existing project scripts:

```bash
npm install
npm run lint
npm run test
npm run typecheck
npm run build
```

Use `npm run dev` for local development.

## Implementation order
Follow `docs/IMPLEMENTATION-PLAN.md`.

Priority:
1. room-rule configuration
2. backend pending-request enforcement
3. approval behavior
4. song-source abstraction
5. YouTube search
6. YouTube player
7. house-track interleaving
8. operator UX
9. end-to-end pilot validation

## Implementation constraint
If an implementation choice conflicts with the documentation, do not silently redesign the architecture. Update the relevant ADR/decision document first or document the blocker explicitly.
