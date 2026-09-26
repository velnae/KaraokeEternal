# Karaoke MVP — Architecture

## Base project
- Starting point: Karaoke Eternal
- Repository: https://github.com/bhj/KaraokeEternal
- Strategy: fork and extend, not rewrite.

## MVP topology
Single instance per karaoke venue. No multi-tenant SaaS in MVP.

Participants join through a QR code from their phones.
The main karaoke PC runs the web player in fullscreen and outputs video through HDMI to TVs.

## Inherited stack
- Node.js 24+
- TypeScript
- Koa
- React
- Redux / Redux Toolkit
- Socket.IO
- SQLite
- Vitest
- Webpack

## Reuse as-is or with minimal changes
- Rooms
- Guest users
- Roles
- QR access
- Mobile web client
- Socket.IO realtime infrastructure
- Fullscreen player
- Queue UI
- SQLite and migrations
- Local media library

## Architectural decisions for MVP
- Keep the existing round-robin queue calculation in the frontend/player.
- Backend remains authoritative for permissions, limits and validations.
- Do not create a backend canonical scheduler yet.
- No offline mode.
- No multi-tenant model.
- YouTube is added as an additional song source.
- Use official YouTube APIs for search/playback.

## Proposed extensions
### Song sources
Introduce a source abstraction:

SongSource
- LocalSongSource
- YouTubeSongSource

### Playback
Extend the player with:
- CDGPlayer
- MP4Player
- YouTubePlayer

### Backend rules
Backend validates:
- max pending requests per participant
- room permissions
- approval mode
- whether a request can enter the queue

## Participant identity
The main identity is the participant/singer, not the table.
Table can be added later as optional metadata.

## MVP queue responsibility
Frontend/player:
- existing fair round-robin ordering
- determines the next fair participant using existing selector logic

Backend:
- validates limits
- validates permissions
- persists queue/request state
- broadcasts changes through Socket.IO
