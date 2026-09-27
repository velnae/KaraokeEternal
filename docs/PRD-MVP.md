# Karaoke MVP — Product Requirements Document

## 1. Product objective

Create a web-based karaoke request system for a single venue. Customers join a room from their phones, search local or YouTube karaoke tracks, submit requests and participate in a configurable queue controlled by the venue operator.

The MVP must prove the complete in-venue experience without turning the product into a multi-tenant SaaS or replacing Karaoke Eternal's working foundation.

## 2. Success criteria

The pilot is successful when:

1. An operator can create/open a room and configure its queue rules.
2. The room player displays a QR code.
3. A customer can join as a guest using an alias.
4. The customer can search both the local library and YouTube.
5. The customer can request an available track.
6. The backend consistently enforces configured room rules.
7. Automatic and manual approval modes both work.
8. Multiple participants are ordered using FAIR or FIFO as configured.
9. Available house tracks are interleaved according to the configured amount.
10. The main player reproduces local CDG, local MP4 and YouTube content.
11. The operator can approve, reject, move, remove, pause, resume and skip.
12. Refreshing or reconnecting a player does not cause played songs to count as pending again.

## 3. Actors

### Participant

- Joins through the room QR code.
- Enters a display alias.
- Searches songs.
- Submits and removes their own requests.
- Sees whether a request is awaiting approval, approved, playing, played, rejected, removed or failed.
- Sees an approximate queue position/wait time; it is informational because new participants and operator actions may change it.

### Operator

- Authenticates as an admin.
- Creates, opens, closes and configures rooms.
- Enables guest access and QR behavior.
- Selects approval and rotation modes.
- Approves or rejects participant requests.
- Queues house tracks and explicit operator items.
- Moves or removes queue items.
- Pauses, resumes, skips and recovers failed playback.

### Player

- Runs in a browser on the main karaoke PC.
- Is the single authoritative player for its room during the MVP.
- Calculates upcoming playback order from backend-approved items.
- Selects CDG, MP4 or YouTube playback.
- Reports lifecycle transitions to the backend.
- Sends audio/video through the venue's existing equipment.

## 4. Core flow

1. Operator creates a new room for the karaoke session.
2. Operator configures queue settings and opens the room.
3. Operator starts the fullscreen player.
4. Player shows the room QR.
5. Participant scans the QR and joins as a guest with an alias.
6. Participant searches local and/or YouTube sources.
7. Participant selects a result and submits a request.
8. Backend validates room, permission, source, playability and pending limit.
9. In `AUTO`, the request becomes `APPROVED`; in `MANUAL`, it becomes `PENDING_APPROVAL`.
10. Operator approves or rejects pending requests when required.
11. The player calculates the next item using room ordering and house-track settings.
12. The player reports `PLAYING` and then `PLAYED` or `FAILED`.
13. The participant may request another track whenever their counted pending items are below the configured maximum.
14. Operator closes the room at the end of the session; closed rooms accept no new requests.

## 5. Configurable room rules

### 5.1 Maximum pending requests

- Key: `maxPendingPerParticipant`.
- Allowed values: integer from 1 through 20.
- Default: 2.
- Counts participant items in `PENDING_APPROVAL` or `APPROVED`.
- Does not count `PLAYING`, `PLAYED`, `REJECTED`, `REMOVED` or `FAILED`.
- Admin/operator-created items are exempt.
- The backend is authoritative and returns a clear error containing the effective limit.

### 5.2 Songs per participant turn

- Key: `maxSongsPerParticipantRound`.
- Allowed values: integer from 1 through 5.
- Default: 1.
- Applies only in `FAIR` mode.
- Allows up to the configured number of consecutive songs for one participant before rotating to another participant.
- If no other participant has an approved request, the same participant may continue without waiting for an empty rotation.

### 5.3 House-track interleaving

- Key: `houseTracksBeforeParticipant`.
- Allowed values: integer from 0 through 10.
- Default: 2.
- `0` disables automatic house interleaving.
- The player attempts to reproduce that number of available `HOUSE` items between two participant turns.
- It does not insert house items before the first participant turn after starting playback.
- If fewer house tracks are available, it plays those available and continues; participant playback never blocks waiting for the minimum.
- House items do not consume participant limits or participant turns.

### 5.4 Approval mode

- Key: `approvalMode`.
- Values: `AUTO` or `MANUAL`.
- Default: `AUTO`.
- `AUTO`: valid requests become approved immediately.
- `MANUAL`: valid requests remain pending until an operator approves or rejects them.
- Changing from `MANUAL` to `AUTO` affects new requests only; existing pending requests remain pending so they are not silently accepted.

### 5.5 Rotation mode

- Key: `rotationMode`.
- Values: `FAIR` or `FIFO`.
- Default: `FAIR`.
- `FAIR`: rotates by participant identity and honors `maxSongsPerParticipantRound`.
- `FIFO`: follows approved request creation order and ignores `maxSongsPerParticipantRound`.
- Changing the mode does not alter played/current items or the already locked next turn. It recalculates only subsequent approved items.

## 6. Queue item origins

Every item has one origin:

- `PARTICIPANT`: requested by a customer; subject to approval and pending limits.
- `HOUSE`: selected by the operator for automatic interleaving; exempt from participant limits.
- `OPERATOR`: explicit operator insertion/override; positioned manually and exempt from participant fairness.

Origin is independent of source. For example, a house track may be local or from YouTube.

## 7. Song sources

### Local

- Continue using Karaoke Eternal's scanned library.
- Preserve artist/title search and preferred media behavior.
- Support CDG and MP4 playback.

### YouTube

- Search with YouTube Data API through the backend.
- Playback with YouTube IFrame Player API.
- Return normalized title, channel, duration, thumbnail and video ID.
- Queue only videos considered embeddable/playable when the API provides that information.
- Store a metadata snapshot with the request.
- Do not download, extract audio or provide offline caching.
- If playback fails or the video becomes unavailable, show the failure, mark the item `FAILED` and allow the operator/player to continue.

## 8. Functional requirements

### Room configuration

- Extend the existing `EditRoom` preferences UI.
- Display current/effective queue values.
- Validate ranges in both frontend and backend.
- Persist using the existing room preferences path.
- Broadcast preference changes to connected clients.

### Search

- Allow switching or clearly distinguishing Local and YouTube results.
- Identify every result's source.
- Prevent accidental duplicate submission while a request acknowledgement is pending.
- Provide useful empty, loading, quota and error states.

### Approval

- Present pending requests in a dedicated operator section/filter.
- Approval moves an item into the eligible queue.
- Rejection records the state and removes it from upcoming playback.
- Only an admin can approve/reject.
- The requester receives the updated state in realtime.

### Queue and playback

- Show item origin, source, requester and status where relevant.
- Preserve existing make-next, remove, replay and skip behavior when compatible with the lifecycle.
- Do not reorder played, current or locked-next items after settings change.
- Persist status before broadcasting the transition.
- Recover safely after player refresh/reconnect using persisted states.

## 9. Non-functional requirements

- Mobile-first participant interface.
- No API credentials exposed to browsers.
- Backend authorization for every mutating operation.
- Idempotent lifecycle updates.
- Useful user-facing errors rather than silent failures.
- New business rules covered by automated tests.
- Existing local-only flow must continue working when YouTube is not configured.
- A YouTube outage/quota failure must not prevent local playback.

## 10. Acceptance scenarios

### Automatic approval and limit

Given limit 2 and `AUTO`, when a participant has two approved upcoming requests, a third request is rejected. After one becomes `PLAYING`, another request is allowed.

### Manual approval

Given `MANUAL`, a new participant request appears as pending and is not selected by the player until an operator approves it.

### Fair rotation

Given `FAIR` and one song per turn, requests `Juan 1`, `Juan 2`, `María 1`, `Pedro 1`, `María 2` are played by alternating eligible participants while preserving each participant's internal order.

### FIFO

Given `FIFO`, approved participant requests follow their creation order regardless of requester.

### House tracks

Given a value of 2, available house items are played between participant turns. If only one is available, it is played and then the next participant continues.

### Player reconnect

Given previously played items, when the player refreshes and reconnects, those items remain `PLAYED` and do not return to pending counts or upcoming playback.

### YouTube failure

Given an approved YouTube item that becomes unavailable, the item becomes `FAILED`, clients are notified and playback can proceed to the next eligible item.

## 11. Out of scope

- Multi-tenant SaaS.
- Centralized multi-venue administration.
- Offline mode.
- Native Android/iOS applications.
- Payments and reservations.
- WhatsApp login.
- Singer scoring.
- Microphone/audio analysis.
- AI singer evaluation.
- YouTube download or offline cache.
