# Transition video — upload, configuration and preview

**Status: upload, preparation, room configuration, local preview and live player
transition integration implemented.**

An operator can upload a short video, preview it beneath sample transition text,
adjust its darkness and save it as the room's transition background. The output is
a reusable silent visual resource consumed by the player, where
greeting/announcement text and the existing voice/ambience channels accompany it.

## Delivery contract

- One selected background per room, with a replacement candidate during preparation.
- The video supplies motion; HTML supplies text; existing audio channels supply sound.
- Upload and preview are local administrative operations. Saving selects the visual
  resource for subsequent authorized player transitions; it does not request speech.
- Preserve the existing karaoke theme, Spanish UI and English technical identifiers.
- Store files beneath the running server's `KES_PATH_DATA`; use its existing SQLite
  connection. Do not select a different database or hardcode a home-directory path.

### Initial supported video profile

| Property | Proposed limit/behavior |
| --- | --- |
| Input | Local MP4 upload containing H.264 video; validate actual media contents. |
| Duration | More than zero, at most 30 seconds. This is a file limit, not a transition duration. |
| Resolution and frame rate | Up to 1920 × 1080, 30 fps; recommend landscape 16:9. |
| File size | At most 40 MiB, enforced before multipart storage and after preparation. |
| Browser compatibility | Validate a supported 8-bit video profile/pixel format; reject incompatible input with export guidance. |
| Sound | Produce a silent derivative, removing source audio tracks. |
| Preview | Muted, inline, looping; playback begins through the preview control. |
| Fallback | Generated poster, then the existing dark background. |

The first implementation validates/remuxes compatible input rather than adding a
general video-transcoding queue. Validate these limits against the actual display
machine before expanding accepted formats or resolutions.

## Implementation order

### 1. Define the resource and room-setting contracts

**Files:** `shared/transitionVideo.ts`, `server/TransitionVideo/Store.ts`,
`server/lib/schemas/022-transition-video.sql`, `shared/types.ts`,
`server/Rooms/Rooms.ts` and `server/Rooms/socket.ts`.

- [x] Define resource states `preparing`, `ready`, `failed` and the DTO delivered to
  administrators: ID, title, state, reason, duration, dimensions, frame rate, size,
  checksum and relative video/poster URLs. Keep filesystem paths server-side.
- [x] Add `transitionVideos` metadata: room ownership, request ID, media properties,
  generated filenames, preparation state/error and timestamps. Bytes remain on disk.
- [x] Add versioned `transitionVideo` room preferences:
  `{ videoId: string | null, dimOpacity: number, revision: number }`.
  Start unselected, with darkness defaulting to 0.55; permit values from 0 to 0.85.
- [x] Only select a `ready` resource belonging to the current room. Save through a
  dedicated version-checked operation; stale edits receive a reload instruction.
- [x] Preserve this field through generic room edits, following the existing
  protection for live `animation` preferences. Retain the participant-pref whitelist.

**Acceptance:** a selection survives restart, another room cannot select it, and
stale room-editor/settings submissions cannot overwrite the current choice.

**Implemented contract:** `saveTransitionVideoSettings(roomId, prefs)` accepts the
expected `revision` and returns the incremented revision. One SQL write checks
revision, resource ownership and readiness. A stale save throws
`TransitionVideoConflictError` with `status: 409` and a reload instruction; the
dedicated HTTP route preserves that status. Generic room updates preserve the persisted
field at SQL write time, including during asynchronous password hashing. Socket
preference previews use the saved background instead of client-supplied values.

Resource IDs and filenames are generated; `(roomId, requestId)` identifies a
single attempt. Ready/failed resources cannot be overwritten through the store.
The DTO exposes base-relative URLs without filesystem names. Preparation validates
and publishes both files before marking a resource ready. Retired resources retain
request receipts but expose no playable URLs; see step 2.

**Verification:** focused tests cover schema-21 upgrade, close/reopen persistence,
request deduplication, metadata/settings validation, room isolation, failed
replacement, stale revisions, overlapping room edits, socket updates and
participant filtering. Run with:

```sh
npm test -- shared/transitionVideo.test.ts server/TransitionVideo server/Rooms
npm run typecheck
```

Initial step-1 results: 52 focused tests, typecheck and whitespace checks passed. Changed-file
ESLint reports only five pre-existing `no-explicit-any` findings in `Rooms.ts`,
confirmed against `HEAD`. A read-only Playwright smoke check over
`https://karaoke.puyu.pe/` passed: the page loads with `no-store`, no page errors,
and anonymous room responses omit background preferences. The future upload and
settings UI flow is not covered by this smoke check.

### 2. Prepare uploaded video without holding a settings request open

**Files:** `server/TransitionVideo/Preparation.ts`, `Service.ts`, `Store.ts` and
`server/lib/schemas/023-transition-video-retention.sql`.

- [x] Check FFmpeg/media-probe availability and report missing tools explicitly.
- [x] Inspect container, codec, duration, dimensions and frame rate. Validate decoding,
  remove audio/extra tracks, remux for progressive playback and generate a poster.
- [x] Use generated identifiers and staging files; verify the prepared derivative,
  checksum and poster before atomic publication and the `ready` database update.
- [x] Accept one preparation at a time on the server, with bounded subprocess time
  and cancellation. Report a busy operation instead of accumulating an upload queue.
- [x] After a complete upload is accepted, return its resource ID and `preparing`
  state promptly; the UI reads preparation progress separately.
- [x] Repeated upload request IDs identify the same attempt. Replacing a file creates
  a new immutable candidate; it does not overwrite the currently selected file.
- [x] On failure or restart, mark incomplete work failed and clean staging files.
  A failed candidate leaves the prior selected background usable.
- [x] Bound retained candidates: selected resource plus latest candidate per room;
  clean discarded candidates and obsolete files only when no preview is streaming
  them. Live transitions additionally hold bounded resource leases for their grants.

**Acceptance:** valid input produces a silent playable MP4 and poster; malformed,
oversized or interrupted input gives a recoverable error and preserves the old video.

**Implemented lifecycle:** files live under `KES_PATH_DATA/transition-video`, with
per-upload/job directories beneath `.staging`. Tools use `KES_FFMPEG_PATH` and
`KES_FFPROBE_PATH`, defaulting to `ffmpeg`/`ffprobe` on `PATH`. Admission covers
upload and preparation together: one operation, no waiting queue, a 120-second
upload deadline and a 60-second preparation deadline. Shutdown aborts active work;
restart fails incomplete attempts and removes staging and partial publication.

The accepted H.264 profiles are Baseline, Constrained Baseline, Main and High up
to level 4.1, with `yuv420p`. The service validates actual container/stream metadata,
copies only the video stream with fast-start metadata, fully decodes that derivative,
creates a JPEG and computes SHA-256 from a stream. Both final renames precede `ready`.

Retirement preserves `(roomId, requestId)` receipts in SQLite using migration 023's
`retiredAt`. It removes obsolete binaries only after active response streams release
their references. Retried retired/failed attempts keep their ID; a new upload attempt
needs a new request ID. Selected resources survive invalid replacements and missing
preparation tools. Stream references are supplemented by bounded live-playback leases,
as described in the live integration section below.

### 3. Expose bounded, room-scoped HTTP operations

**Files:** `server/TransitionVideo/{router,upload,stream}.ts`, `server/serverWorker.ts`.

Implemented route family: `/api/animation/background`, beneath `KES_URL_PATH`.

| Operation | Purpose |
| --- | --- |
| `GET /` | Current room settings, selected resource, candidate and preparation capability. |
| `POST /upload` | One multipart file and request ID; return accepted preparation state. |
| `GET /videos/:id` | Preparation state and resource details. |
| `GET /videos/:id/video` | Authenticated streaming with range support. |
| `GET /videos/:id/poster` | Poster for the current room's resource. |
| `PUT /` | Save the ready selection and darkness using the expected revision; null clears selection. |

- [x] Authenticate administrator and room before multipart parsing. Add a dedicated
  video upload limit; the current special parser covers audio routes only.
- [x] Stream the file rather than loading it through the audio buffer/download API.
- [x] Respect `KES_URL_PATH`, abort disconnected uploads and clean parser temporaries
  on size errors as well as route failures.
- [x] Notify same-room administrators of saved settings using the established room
  preference update mechanism, retaining participant filtering.

**Acceptance:** upload, polling and seeking work under a URL prefix; anonymous,
participant and cross-room accesses are rejected without storing unauthorized uploads.

**Upload contract:** send one multipart `file`, `requestId` and optional `title`.
Also send `X-Upload-Request-Id` with the same ID to recover a previous attempt before
resending bytes, including when preparation is busy. The header alone may identify
the attempt; if the multipart field is present it must match. New accepted uploads
return `202`/`preparing`; status polling returns the resource DTO. Admission conflicts
return `409`, size limits `413`, invalid metadata `422`, unavailable tools `503` and
unauthorized access `403`. Retired asset endpoints return `404`.

The background route bypasses the global body/range middleware, including case
aliases. Authorization is attached to every endpoint before its parser, which
bounds one file and its fields and awaits writer closure before
deleting upload temporaries on errors/disconnects. Streaming supports GET/HEAD,
bounded/open-ended/suffix ranges, `If-Range` and `416` with `Content-Range`. Unsupported
units and multi-ranges fall back to a full response. The development webpack middleware
now defers HTML index delivery to `createClientIndex`, preserving the URL prefix.

**Initial backend verification:** 90 focused tests cover actual exports/decoding, stream
ranges, HTTP boundaries, timeout/shutdown/disconnect cleanup, retention and migration
from schemas 21/22. The isolated full-server harness uploads a real MP4, checks silent
output, plays it in Chromium, verifies cross-room access and failed replacement, and
restarts the server. It passes in development and production:

```sh
npm test -- shared/transitionVideo.test.ts server/TransitionVideo server/Rooms
npm run test:transitions:video
KARAOKE_E2E_MODE=development npm run test:transitions:video
```

Production harness execution requires current server/client builds. Typecheck,
changed backend/harness lint and whitespace checks pass. HTTPS smoke checks verified
page loading, `no-store`, and rejection of anonymous settings/upload/ranged-media
requests at `https://karaoke.puyu.pe/`. Those initial authenticated runs used isolated
local servers. Direct authenticated shared-tunnel evidence is recorded below under
delivery phase 4.

### 4. Build the reusable visual background and local preview

**Files:** `src/components/TransitionBackground/TransitionBackground.tsx` and CSS.

- [x] Accept a versioned resource, darkness and an explicit `playing` prop. Render a
  decorative `<video muted playsInline loop>` behind a dark scrim and content slot.
- [x] Keep voice/ambience outside this component. Its media events must never be
  interpreted as musical playback, song completion or an announcement acknowledgment.
- [x] Preserve the video element while sample text changes. Handle readiness, rejected
  playback, decode failure and buffering with the poster/dark fallback.
- [x] Stop on preview closure, route exit or resource replacement; release abandoned
  requests/media references. Handle React StrictMode mount/cleanup correctly.
- [x] Honor reduced motion with a still preview by default and an explicit local
  play control. Hide the decorative video from assistive technology; retain readable HTML.

**Acceptance:** sample text remains legible over moving video, failures preserve the
text and no preview leaves background media running after the panel closes.

The media child is keyed by resource identity/version, not by sample text. Cleanup
pauses the element, removes its source and calls `load()` to release abandoned media
requests; setup restores the source when StrictMode replays effects. Each explicit
play attempt clears earlier rejection state. The initial view is still; changing
the reduced-motion preference pauses playback, while explicit local play remains
available. A paused loaded frame is retained; loading/errors use the poster or dark
background without removing the HTML text.

### 5. Add the room's Fondo settings panel

**Files:** `src/components/Animation/TransitionVideoSettings.tsx` and CSS,
`useTransitionVideoSettings.ts`, `transitionVideoState.ts`,
`src/lib/transitionVideoApi.ts`, and `src/components/Admin/AnimatorSettings.tsx`.
The panel is available at `/admin/settings/animator?view=background`.

Implemented hierarchy:

```text
Fondo de transición
  Vista previa local — not transmitted to the player
  Preview: video + dark overlay + sample text
  [Karaoke | Saludo | Anuncio]    [Reproducir / Pausar vista previa]
  Current file and upload/preparation status
  [Subir video / Reemplazar video]
  Video para la vista previa [selection]
  Oscurecimiento [slider]
  [Guardar fondo]    [Quitar selección]
```

- [x] Reuse existing panel, button, input, cyan/white/dark theme and focus styles.
  Place controls under the preview on mobile; reserve safe margins around overlay text.
- [x] Show upload progress separately from media preparation. Represent empty,
  uploading, preparing, ready, saving, saved and error states with a clear next action.
- [x] Explain: `El video se guarda sin sonido. Las voces y el ambiente se añaden por separado.`
- [x] Provide three sample-text layouts using fixture content, so the operator can
  assess karaoke identity, greeting readability and an animator announcement.
- [x] Label playback `Vista previa local`. `Guardar fondo` persists only the ready
  selection and darkness; it must not claim the video is already live in the player.
- [x] Preserve unsaved darkness/selection edits during polling. Show a reload action
  on revision conflicts and reconcile saved state after uncertain network responses.
- [x] Associate disabled actions with visible explanations: e.g. preparation in
  progress or connection lost. Do not conflate uploading with authorizing room audio.

**Acceptance:** upload → ready → preview → adjust → save → reload reproduces the same
selection/settings. All controls work with keyboard and at 390/1440px viewport widths.

The panel mounts per room and works independently of the animator's enable switch
or live socket connection. Its reducer keeps the local selection, darkness and
expected revision separate from refreshed server data. Polling is sequential and
abortable; uploads/saves pause polling. Old responses cannot undo a newer save.

The API helper uses same-origin, base-relative HTTP requests and XHR upload progress.
An uncertain upload is recovered using its original request ID before retrying. An
uncertain save is reconciled against server settings; unconfirmed writes keep the
draft and expose check/retry actions. Conflicting remote changes require an explicit
reload, with a visible warning that local edits will be discarded. Removing the
selection changes only the draft until `Guardar fondo` is pressed.

`Fondo` also exposes **Sonido de pausa**: the existing ambience enable/volume
controls from `OperationControls`. They share the versioned animation settings with
`Control → Ajustes` and apply when the adjustment ends, independently of `Guardar
fondo`. The video preview remains silent. Audio controls explain when the live room
connection is unavailable; keyboard and blur commits avoid redundant updates.

### 6. Verify and document the deliverable

- [x] Unit/integration: metadata and settings validation, silent output, real video
  probing, request deduplication, concurrent saves, interrupted preparation, replacement
  failure, access boundaries, range streaming and temporary-file cleanup.
- [x] Extend the implemented `test:transitions:video` isolated Playwright harness
  with sample layouts, keyboard controls and UI preparation states. Real upload,
  silent output, second-room access, playback and restart are already covered.
- [x] Run in development/StrictMode and production. Inspect screenshots at 390/1440px
  and verify that preview produces no voice generation, room announcement or queue edit.
- [x] Run typecheck, focused tests/lint, affected builds and `git diff --check`.
  Record actual results; backend evidence is recorded above and UI evidence below.
- [x] Document accepted exports, upload limits, replacement recovery and the next
  integration step. Group implementation with its tests by behavior: server asset
  lifecycle; settings/preview; end-to-end integration evidence.

**UI evidence:** 12 focused reducer tests pass. Full-browser checks passed native
upload → preparation → preview → adjustment → save → reload, stable video identity
across all sample layouts/polling, keyboard controls, revision conflicts, lost
upload/save responses, decode fallback, repeated rejected-play recovery, reduced
motion, route/tab cleanup, room changes and restart. A pending resource absent from
the latest-candidate list is checked separately before treating it as unavailable;
confirmed retirement preserves the draft and offers another selection. Queue, announcement and audio
generation counts remain unchanged. Screenshots at 390/1440px were inspected in
development and production; small preview text and the native select arrow were
adjusted for readability. Typecheck, changed UI/harness lint and the client build
pass (the build retains size/license warnings).

```sh
npm test -- src/components/Animation/transitionVideoState.test.ts
npm run typecheck
npm run test:transitions:video
KARAOKE_E2E_MODE=development npm run test:transitions:video
KARAOKE_E2E_MODE=development KARAOKE_E2E_HTTPS_UI=1 npm run test:transitions:video
```

The HTTPS mode exercises the actual interface/assets at `https://karaoke.puyu.pe/`
with every API call forwarded to the isolated fixture server. Both Socket.IO
transports are blocked, which also checks that background configuration works without
live animator connectivity. Multipart fixture bodies are reconstructed by this test
bridge because browser interception can omit disk-backed file bytes; unproxied local
runs validate the native XHR upload path. This protects shared data and verifies the
HTTPS UI, but does not claim authenticated upload/streaming through the shared tunnel
backend. Screenshot artifacts are written to each harness's printed temporary folder.

### Delivery phase 4 — real-file verification (2026-11-03)

The requested `salida.mp4` was loaded into the running **Sala 1** through the actual
authenticated HTTPS API and selected/saved through the Fondo UI. This was a
user-requested import, not an automated fixture written into shared data.

| Property | Verified result |
| --- | --- |
| Original | H.264 High, 8-bit `yuv420p`, 1920 × 1080, 30 fps, AAC audio; 901 frames / 30.033333 s. |
| Compatible copy | Separate silent export: 900 frames / exactly 30 s, H.264 High, 1080p, 30 fps, 8,733,421 bytes. The original file was not edited. |
| Resource | `819b7830-a5af-4598-bf20-cb82748ef22e`, title `salida — fondo de transición`, state `ready`. |
| Saved settings | Sala 1, darkness 0.55, revision 1; selection and darkness survive page reload. |
| Actual playback | 1920 × 1080 frames decoded, muted, no decoded audio; sample changes retain the same video element. Seeking to 28.5 s returns through the loop to the beginning. |
| Actual streaming | Authenticated `Range: bytes=-32` returns `206` and `Content-Range: bytes 8733389-8733420/8733421`. |
| UI | Desktop and 390px screenshots inspected; no horizontal overflow; preview is paused after reload. Main playback continues to display `En pausa`. |

The original exceeded the limit by one frame, so a separate compatible copy was
prepared explicitly before upload; server validation still enforces the 30-second
limit and does not silently trim files. Duration rejection now reports milliseconds
and asks the operator to trim, rather than suggesting an unrelated codec change.

The connected Chrome instance disallowed setting native file inputs through its
debugging protocol. The import used its authenticated request context to upload the
compatible copy through the real API instead. Preview, sample changes, save and
reload were then exercised in the real UI without the isolated API bridge. Files
remain under the running server's configured data directory; the staging copy and
screenshots in `.playwright-mcp/` are ignored development artifacts.

This verification also found duplicate sibling React keys: the hidden audio panel
and Fondo panel were both keyed by `roomId`. The background key is now namespaced.
After reload, the actual page reports zero console errors/warnings, and the E2E
harness now fails on React console warnings as well as uncaught page errors.

Phase-4 results: **103 focused tests passed**, development/StrictMode and production
E2E passed, typecheck and changed-file ESLint passed, server/client builds completed,
and whitespace checks passed. The client build still emits size/license warnings.

```sh
npm test -- shared/transitionVideo.test.ts server/TransitionVideo server/Rooms src/components/Animation/transitionVideoState.test.ts
```

## Live player integration

`PlayerController` now uses `PlayerTransitionScene` for announcements, effects,
greeting introductions/cards and idle ambience. It reuses `TransitionBackground` in
a full-screen layout; foreground text is transparent instead of covering the video
with an opaque black screen. Reduced motion uses the still fallback. Video failure
never acknowledges speech, finishes a song or holds the queue.

Song transitions begin with about two seconds of background and ambience before
the greeting or announcement. Voice/effects remain one ordered foreground sequence.
A prepared, approved ambience clip runs on the separate bed channel at the configured
`ambienceVolume`, independently of voice volume and without automatic ducking.
Its duration does not add to the foreground duration or voice budget. A nonrenewable
40-second permit can cover the intro, speech and next-song loading. The next media
starts muted behind the same scene; the bed fades out before music becomes audible.
Loading failures expose the existing player recovery controls after ten seconds or
an autoplay pause. Natural boundaries
with a next song can use an eligible transition separator when no contextual effect
was selected. Existing profile restrictions, readiness, cooldowns and budget guards
remain effective. Bed/separator usage does not consume the closing-applause cooldown.

The player advertises `transitionBed: true` with `ANIMATION_READY`. Older clients
that do not support the parallel channel receive no appended bed, avoiding accidental
sequential ambience playback. Reload an already-open player after deploying this
integration. A second player still cannot take over an occupied room.

Migration `024-transition-video-leases.sql` pins the selected immutable resource and
appearance snapshot to bounded playback grants. Replacing the configured video cannot
remove the old scene's files between range requests. Greeting-only visual grants are
also protected. Idle renewal can adopt new settings while retaining the previous
in-flight asset until its original deadline. Expiry schedules cleanup even without
another upload. Media transfers retain their existing stream references as well.

Decorative media carries `data-media-role="transition-background"`; playback tests
exclude it from musical `playing` events. The dedicated harness measures concurrent
bed/voice and bed/effect playback, forbids foreground overlap, and confirms all
transition audio ends before musical playback becomes audible. It also verifies settings are
frozen during a granted scene, video failure does not delay music, and pause/route exit
stop media. Greeting regression checks now use a real background and retain the same
video element across introduction and greeting text.

```sh
npm run test:transitions:player
KARAOKE_E2E_MODE=development npm run test:transitions:player
KARAOKE_E2E_MODE=development KARAOKE_E2E_HTTPS_UI=1 npm run test:transitions:player
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:greetings:playback
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium KARAOKE_E2E_MODE=development npm run test:greetings:playback
```

Verification passed: dedicated player E2E in development/StrictMode and production;
greeting playback in both modes; existing phase-2 animator E2E in production; focused
audio/animation/greeting/video-retention tests; typecheck, changed-file lint and builds.
Desktop/mobile player screenshots were inspected. The HTTPS player harness uses the
actual shared frontend with isolated API and Socket.IO polling (WebSocket upgrades
are disabled for that bridge), so automated fixtures never touch the shared queue.
The real Sala 1 already had an authoritative player in another instance: the temporary
HTTPS player correctly displayed the occupied-room notice and was closed. Its owner
must reload that existing instance to use the updated player; a second public player
was not forced into the room.

## Completion and operation

The operator can upload a real video, see it moving beneath sample text, save a
room-specific background and recover that configuration after restart. The player
uses it during authorized transitions while greeting/animator logic owns audio and
timing. Pausing/skipping interrupts the current intervention; a manual skip does not
fabricate a natural song-ending announcement.

The resource contract exposes identity/version, readiness, video/poster URLs and
appearance settings. It grants no authority to play speech and imposes no delay on
the musical queue. The video may loop, but its file duration never determines how
long the transition lasts.

Operational rollback clears the selected background and hides the new panel/feature.
Keep the migration installed; binary downgrade requires the project's normal matching
database backup procedure. Preserve current audio, greeting and queue data.
