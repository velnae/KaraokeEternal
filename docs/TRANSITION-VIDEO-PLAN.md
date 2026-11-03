# Transition video — upload, configuration and preview

**Status: implementation plan; application changes are pending.**

An operator can upload a short video, preview it beneath sample transition text,
adjust its darkness and save it as the room's transition background. The output is
a reusable silent visual resource for the subsequent player integration, where
greeting/announcement text and the existing voice/ambience channels accompany it.

## Delivery contract

- One selected background per room, with a replacement candidate during preparation.
- The video supplies motion; HTML supplies text; existing audio channels supply sound.
- Upload and preview are local administrative operations. Saving a background records
  the choice; live transition playback is connected in the next block.
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

**Files:** new `shared/transitionVideo.ts`, `server/TransitionVideo/Store.ts`, next
available migration in `server/lib/schemas/`, plus `shared/types.ts` and
`server/Rooms/Rooms.ts`.

- [ ] Define resource states `preparing`, `ready`, `failed` and the DTO delivered to
  administrators: ID, title, state, reason, duration, dimensions, frame rate, size,
  checksum and relative video/poster URLs. Keep filesystem paths server-side.
- [ ] Add `transitionVideos` metadata: room ownership, request ID, media properties,
  generated filenames, preparation state/error and timestamps. Bytes remain on disk.
- [ ] Add versioned `transitionVideo` room preferences:
  `{ videoId: string | null, dimOpacity: number, revision: number }`.
  Start unselected, with darkness defaulting to 0.55; permit values from 0 to 0.85.
- [ ] Only select a `ready` resource belonging to the current room. Save through a
  dedicated version-checked operation; stale edits receive a reload instruction.
- [ ] Preserve this field through generic room edits, following the existing
  protection for live `animation` preferences. Retain the participant-pref whitelist.

**Acceptance:** a selection survives restart, another room cannot select it, and
stale room-editor/settings submissions cannot overwrite the current choice.

### 2. Prepare uploaded video without holding a settings request open

**Files:** new `server/TransitionVideo/Preparation.ts` and service lifecycle module;
reuse the existing process-execution and atomic-publication patterns.

- [ ] Check FFmpeg/media-probe availability and report missing tools explicitly.
- [ ] Inspect container, codec, duration, dimensions and frame rate. Validate decoding,
  remove audio/extra tracks, remux for progressive playback and generate a poster.
- [ ] Use generated identifiers and staging files; verify the prepared derivative,
  checksum and poster before atomic publication and the `ready` database update.
- [ ] Accept one preparation at a time on the server, with bounded subprocess time
  and cancellation. Report a busy operation instead of accumulating an upload queue.
- [ ] After a complete upload is accepted, return its resource ID and `preparing`
  state promptly; the UI reads preparation progress separately.
- [ ] Repeated upload request IDs identify the same attempt. Replacing a file creates
  a new immutable candidate; it does not overwrite the currently selected file.
- [ ] On failure or restart, mark incomplete work failed and clean staging files.
  A failed candidate leaves the prior selected background usable.
- [ ] Bound retained candidates: selected resource plus latest candidate per room;
  clean discarded candidates and obsolete files only when no preview is streaming
  them. Future live-transition integration must extend this protection to its grants.

**Acceptance:** valid input produces a silent playable MP4 and poster; malformed,
oversized or interrupted input gives a recoverable error and preserves the old video.

### 3. Expose bounded, room-scoped HTTP operations

**Files:** new `server/TransitionVideo/router.ts`, `server/serverWorker.ts`.

Proposed route family: `/api/animation/background`.

| Operation | Purpose |
| --- | --- |
| `GET /` | Current room settings, selected resource, candidate and preparation capability. |
| `POST /upload` | One multipart file and request ID; return accepted preparation state. |
| `GET /videos/:id` | Preparation state and resource details. |
| `GET /videos/:id/video` | Authenticated streaming with range support. |
| `GET /videos/:id/poster` | Poster for the current room's resource. |
| `PUT /` | Save the ready selection and darkness using the expected revision; null clears selection. |

- [ ] Authenticate administrator and room before multipart parsing. Add a dedicated
  video upload limit; the current special parser covers audio routes only.
- [ ] Stream the file rather than loading it through the audio buffer/download API.
- [ ] Respect `KES_URL_PATH`, abort disconnected uploads and clean parser temporaries
  on size errors as well as route failures.
- [ ] Notify same-room administrators of saved settings using the established room
  preference update mechanism, retaining participant filtering.

**Acceptance:** upload, polling and seeking work under a URL prefix; anonymous,
participant and cross-room accesses are rejected without storing unauthorized uploads.

### 4. Build the reusable visual background and local preview

**Files:** new `src/components/TransitionBackground/TransitionBackground.tsx` and CSS.

- [ ] Accept a versioned resource, darkness and an explicit `playing` prop. Render a
  decorative `<video muted playsInline loop>` behind a dark scrim and content slot.
- [ ] Keep voice/ambience outside this component. Its media events must never be
  interpreted as musical playback, song completion or an announcement acknowledgment.
- [ ] Preserve the video element while sample text changes. Handle readiness, rejected
  playback, decode failure and buffering with the poster/dark fallback.
- [ ] Stop on preview closure, route exit or resource replacement; release abandoned
  requests/media references. Handle React StrictMode mount/cleanup correctly.
- [ ] Honor reduced motion with a still preview by default and an explicit local
  play control. Hide the decorative video from assistive technology; retain readable HTML.

**Acceptance:** sample text remains legible over moving video, failures preserve the
text and no preview leaves background media running after the panel closes.

### 5. Add the room's Fondo settings panel

**Files:** new `src/components/Animation/TransitionVideoSettings.tsx` and CSS;
extend `src/components/Admin/AnimatorSettings.tsx` with `?view=background`.

Suggested hierarchy:

```text
Fondo de transición
  Current file and preparation status
  [Subir video / Reemplazar video]
  Preview: video + dark overlay + sample text
  [Karaoke | Saludo | Anuncio]    [Reproducir / Pausar vista previa]
  Oscurecimiento [slider]
  [Guardar fondo]    [Quitar selección]
```

- [ ] Reuse existing panel, button, input, cyan/white/dark theme and focus styles.
  Place controls under the preview on mobile; reserve safe margins around overlay text.
- [ ] Show upload progress separately from media preparation. Represent empty,
  uploading, preparing, ready, saving, saved and error states with a clear next action.
- [ ] Explain: `El video se guarda sin sonido. Las voces y el ambiente se añaden por separado.`
- [ ] Provide three sample-text layouts using fixture content, so the operator can
  assess karaoke identity, greeting readability and an animator announcement.
- [ ] Label playback `Vista previa local`. `Guardar fondo` persists only the ready
  selection and darkness; it must not claim the video is already live in the player.
- [ ] Preserve unsaved darkness/selection edits during polling. Show a reload action
  on revision conflicts and reconcile saved state after uncertain network responses.
- [ ] Associate disabled actions with visible explanations: e.g. preparation in
  progress or connection lost. Do not conflate uploading with authorizing room audio.

**Acceptance:** upload → ready → preview → adjust → save → reload reproduces the same
selection/settings. All controls work with keyboard and at 390/1440px viewport widths.

### 6. Verify and document the deliverable

- [ ] Unit/integration: metadata and settings validation, silent output, real video
  probing, request deduplication, concurrent saves, interrupted preparation, replacement
  failure, access boundaries, range streaming and temporary-file cleanup.
- [ ] Add an isolated Playwright harness, proposed `test:transitions:video`, with a
  real short MP4 fixture and a second-room user. Exercise upload, sample layouts,
  keyboard controls, reload/restart persistence and slow/failed preparation.
- [ ] Run in development/StrictMode and production. Inspect screenshots at 390/1440px
  and verify that preview produces no voice generation, room announcement or queue edit.
- [ ] Run typecheck, focused tests/lint, affected builds and `git diff --check`.
  Record actual results; the new-flow checks above are planned, not already executed.
- [ ] Document accepted exports, upload limits, replacement recovery and the next
  integration step. Group implementation with its tests by behavior: server asset
  lifecycle; settings/preview; end-to-end integration evidence.

## Completion and handoff

The operator can upload a real video, see it moving beneath sample text, save a
room-specific background and recover that configuration after restart. The next
block consumes the ready visual resource and the reusable background component from
`PlayerController`, while existing greeting/animator logic owns audio and timing.

The resource contract exposes identity/version, readiness, video/poster URLs and
appearance settings. It grants no authority to play speech and imposes no delay on
the musical queue. Before live integration, extend in-use retention and distinguish
decorative-video events in playback tests that currently treat every media `playing`
event as a song start.

Operational rollback clears the selected background and hides the new panel/feature.
Keep the migration installed; binary downgrade requires the project's normal matching
database backup procedure. Preserve current audio, greeting and queue data.
