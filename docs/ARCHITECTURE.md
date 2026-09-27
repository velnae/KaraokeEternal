# Karaoke MVP — Architecture

## 1. Base project and strategy

- Starting point: Karaoke Eternal.
- Upstream repository: https://github.com/bhj/KaraokeEternal
- Product repository: https://github.com/velnae/KaraokeEternal
- Strategy: extend the existing application; do not rewrite working functionality.

The MVP is one deployment for one karaoke venue. The inherited multi-room capability remains available, but the pilot assumes one active room and one active player per room. Multi-tenant SaaS and centralized multi-venue administration are not part of the MVP.

## 2. Runtime topology

1. The server hosts the web application, API, Socket.IO and SQLite database.
2. Participants join a room from their phones through its QR code.
3. The operator manages the room from an authenticated admin session.
4. The main karaoke PC runs the browser player in fullscreen.
5. The player outputs audio/video through the venue's existing HDMI and sound setup.

The server and player may run on the same PC or on different devices in the same reachable network.

## 3. Stack preserved for MVP

- Node.js 24+
- npm 11+
- TypeScript
- Koa
- React
- Redux / Redux Toolkit
- Socket.IO
- SQLite
- Vitest
- Webpack

Do not introduce Laravel, MariaDB/PostgreSQL, Redis, microservices or native mobile applications during the MVP.

## 4. Existing capabilities to reuse

- Rooms and room preferences.
- Admin, standard and guest users.
- QR room access.
- Mobile web client.
- Socket.IO realtime transport.
- Local song library and media scanner.
- Queue UI and linked-list persistence.
- Existing fair round-robin selector.
- CDG and MP4 browser players.
- Operator queue and playback controls.

## 5. Domain model

### 5.1 Participant identity

Queue fairness and limits use `userId`, never the display alias. Two participants may use the same alias and still remain distinct.

- The same browser session keeps the same guest identity while its session is valid.
- Opening the room from another browser/device creates another participant identity.
- A future `tableId` may be stored as optional operational metadata, but it does not affect rotation or limits in the MVP.
- Guest cleanup may occur after a room is removed or through an explicit maintenance process; it must not change queue behavior during an active session.

### 5.2 Queue item

Every request becomes a queue item with enough metadata to work independently of its source:

```text
QueueItem
- queueId
- roomId
- requestedByUserId
- origin: PARTICIPANT | HOUSE | OPERATOR
- source: LOCAL | YOUTUBE
- localSongId?: number
- externalId?: string       # YouTube videoId
- title: string             # immutable request snapshot
- artistOrChannel: string   # immutable request snapshot
- durationSeconds?: number
- thumbnailUrl?: string
- status
- prevQueueId?: number
- dateCreated
- dateUpdated
```

Required invariants:

- `source=LOCAL` requires `localSongId`.
- `source=YOUTUBE` requires `externalId`.
- YouTube results are not inserted into the scanned local library.
- Display metadata is snapshotted when requested so queue history remains understandable even if an external result later changes or disappears.

The implementation may evolve the current `queue` table or add a closely related request table, but it must preserve existing room queues and avoid duplicating two independent scheduling systems.

### 5.3 Request lifecycle

```text
PENDING_APPROVAL -> APPROVED -> PLAYING -> PLAYED
PENDING_APPROVAL -> REJECTED
APPROVED         -> REMOVED
PLAYING          -> FAILED | PLAYED
PLAYING          -> APPROVED (only when the active player leaves unexpectedly)
```

- `AUTO` creates the item directly as `APPROVED`.
- `MANUAL` creates it as `PENDING_APPROVAL`.
- Only `APPROVED` items participate in upcoming playback ordering.
- `PENDING_APPROVAL` and `APPROVED` count toward the participant pending limit.
- `PLAYING`, `PLAYED`, `REJECTED`, `REMOVED` and `FAILED` do not count toward that limit.
- Status transitions are persisted by the backend and broadcast through Socket.IO.
- Player reports must be idempotent: repeating the same transition must not duplicate history or counters.
- If the last active player disconnects while an item is `PLAYING`, the backend returns that item to `APPROVED`; terminal items are never revived.
- The operator queue offers a pending-approval filter with approve/reject actions. Participants see realtime status only for their own pending or rejected requests; these items never enter playable ordering.

Persisting lifecycle state removes the pending-limit dependency on the browser player's ephemeral `historyJSON`. The player may continue to use its history for presentation and round-robin continuity, but it is not the authoritative source for whether a request is pending.

## 6. Queue settings per room

All queue rules are stored in `IRoomPrefs.queue`. Missing or invalid values fall back to defaults.

| Setting | Type/range | Default | Exact behavior |
| --- | --- | ---: | --- |
| `maxPendingPerParticipant` | integer `1..20` | `2` | Maximum combined `PENDING_APPROVAL` + `APPROVED` participant requests. Admin/operator requests are exempt. |
| `maxSongsPerParticipantRound` | integer `1..5` | `1` | In `FAIR`, maximum consecutive participant songs in one turn before rotating to another participant. |
| `houseTracksBeforeParticipant` | integer `0..10` | `2` | Target number of approved `HOUSE` tracks between two participant turns. `0` disables automatic house interleaving. |
| `approvalMode` | `AUTO \| MANUAL` | `AUTO` | Determines initial state of new participant requests. |
| `rotationMode` | `FAIR \| FIFO` | `FAIR` | Selects participant ordering policy. |

Backend validation normalizes these values. The UI must show their effective defaults and reject values outside their range.

## 7. Scheduling responsibility

### 7.1 Backend responsibilities

- Validate room state, permissions and settings.
- Persist queue items and lifecycle states.
- Enforce participant pending limits.
- Approve/reject manual requests.
- Classify item origin and source.
- Validate that an external source is playable before accepting it when practical.
- Broadcast normalized state through Socket.IO.

### 7.2 Frontend/player responsibilities

- Calculate the upcoming order from approved items.
- Preserve Karaoke Eternal's existing fair behavior.
- Apply `rotationMode` and `maxSongsPerParticipantRound`.
- Interleave available house tracks according to room settings.
- Select the correct media player.
- Report playback state transitions to the backend.

The backend does not become a canonical scheduler during the MVP. It is authoritative for item state and rules; the active player is responsible for calculating the next playback item.

## 8. Ordering rules

### 8.1 FAIR

- Group approved `PARTICIPANT` items by `userId` while preserving each participant's request order.
- Choose the participant who has waited the longest since their last played turn.
- Play up to `maxSongsPerParticipantRound` consecutive songs for that participant.
- A newly joined participant is eligible for the next unlocked turn, preserving inherited Karaoke Eternal behavior.
- The player locks the participant for the immediately upcoming item. New requests or preference changes must not replace that already announced turn; only later items are recalculated.

### 8.2 FIFO

- Play approved participant requests by `dateCreated`, using `queueId` as the deterministic tie-breaker.
- `maxSongsPerParticipantRound` does not apply in FIFO because FIFO intentionally does not group or rotate participants.

### 8.3 House tracks

- `HOUSE` items are selected or queued by the operator and form a separate eligible pool.
- Between two participant turns, the player attempts to play `houseTracksBeforeParticipant` approved house items.
- House tracks do not consume a participant turn and do not affect participant fairness history.
- If fewer house items are available, play those available and continue with the next participant; the participant queue must never block waiting for house content.
- The rule is not applied before the first participant turn after playback starts, nor when there are no approved participant requests.

### 8.4 Operator items

- `OPERATOR` identifies an explicit operator insertion or override.
- The operator chooses its position using existing move/make-next controls.
- Operator items are exempt from participant limits and do not alter participant fairness history.

## 9. Song source abstraction

```text
SongSource
|- LocalSongSource
`- YouTubeSongSource
```

Minimal provider contract:

```text
search(query, roomContext) -> SongSearchResult[]
resolve(id, roomContext)   -> ResolvedSong
```

`SongSearchResult` and `ResolvedSong` expose normalized metadata such as source, identifier, title, artist/channel, duration, thumbnail and playability.

### Local source

- Adapts the existing library and scanner.
- Does not rewrite local media persistence.
- Resolves to existing `songId`, `mediaId` and CDG/MP4 playback data.

### YouTube source

- Search runs on the backend so the API key is not exposed to clients.
- Uses YouTube Data API for search and metadata resolution.
- Accepts only video results that are embeddable and usable by the IFrame Player API when that information is available.
- Stores only identifiers and metadata needed for the queue/history.
- Does not download, extract audio or cache YouTube media.
- If a video becomes unavailable, mark the item `FAILED`, notify clients and continue safely to the next item.

## 10. Playback selection

```text
source=LOCAL, mediaType=cdg -> CDGPlayer
source=LOCAL, mediaType=mp4 -> MP4Player
source=YOUTUBE              -> YouTubePlayer
```

The YouTube player must implement the same operational contract needed by `PlayerController`: load, play, pause, resume, end, error and status reporting. Browser autoplay restrictions still apply; the operator starts playback from the player at least once.

## 11. Realtime and authority rules

- Backend acknowledgements are authoritative for add, approve, reject, remove and move operations.
- Optimistic UI must roll back when the backend rejects an action.
- Only admins may configure rooms, approve/reject requests, create `HOUSE`/`OPERATOR` items or manage another participant's requests.
- Participants may create and remove their own eligible requests.
- One active player is supported per room in the MVP. A second player must not silently become authoritative; it should be rejected or shown as a non-authoritative display.

## 12. Explicit exclusions

- Multi-tenant SaaS.
- Centralized multi-venue management.
- Offline mode.
- Native Android/iOS apps.
- Payments and reservations.
- WhatsApp login.
- Singer scoring or microphone analysis.
- AI singer evaluation.
- YouTube downloading, audio extraction or offline caching.
- Backend rewrite of the full round-robin scheduler.
