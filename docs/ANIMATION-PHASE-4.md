# Phase 4 — local greeting voice

## Block 1: connect Chatterbox

The **Voz local** tab in **Ajustes → Animador** connects the karaoke server to an
existing Chatterbox LATAM installation. Block 1 configures and starts the model;
block 2 prepares private greeting audio; block 3 coordinates optional public
reading with a catalog introduction, background ambience and the next song.

### Configure the connection

1. Open **Voz local** and enter the installation's absolute directory on the server,
   for example `/path/to/chatterbox-latam-test`.
2. Select **Guardar y comprobar**. The directory must contain `model.sh`,
   `resident.py`, `speak.py` and executable `.venv/bin/python`.
3. If the model is offline, select **Iniciar modelo**. Loading runs in the background
   while the karaoke remains available.
4. Optionally select **Iniciar el modelo automáticamente al abrir el servidor** and
   save. This starts it now and on subsequent server startups. Clearing the option
   changes future startup behavior; it does not stop a running model.

The configuration is shared by all rooms and available only to administrators.
It is persisted under the `localTts` preference, including a revision used to reject
stale edits. **Recargar ajustes** recovers changes saved by another operator.
The path is resolved on the backend, not on the computer displaying the browser.

### Connection states

| State | Meaning and next action |
| --- | --- |
| Sin configurar | Enter and save the installation directory. |
| Pendiente de comprobar | Saved configuration restored; select **Comprobar conexión**. |
| Comprobando conexión | A status request is in progress. |
| Cargando modelo | Startup is in progress; continue using the karaoke. |
| Modelo listo | The worker confirmed its model is loaded; the last check time is shown. |
| Ocupado o sin respuesta | The socket connected but the worker has not answered. It may be synthesizing elsewhere. |
| Generando saludo | One approved request's greeting is being synthesized in the background. |
| Comprobando una generación anterior | A lost response or restart requires confirming the original worker is idle before proceeding. |
| Sin conexión | No worker is accepting connections; select **Iniciar modelo**. |
| Requiere atención | Review the installation/permissions and retry **Comprobar conexión**. |

A path change is saved immediately but waits for the current worker's response
before activation. A timeout does not prove that inference stopped: the old path
remains active and the pending change remains visible. Checking again can complete
the switch once the worker responds. Existing external workers are left running.

## Runtime contract

- Uses newline-delimited JSON over `<installation>/.tmp/model.sock`. Connection
  checks send `{"action":"status"}` and expect a ready status with a positive PID.
- One status request remains open per service. The UI reads cached state, not a new
  socket probe on every refresh. After 1.5 seconds without a response it reports
  an occupied/unresponsive worker; the request has a ten-minute deadline.
- Model startup has a two-minute readiness deadline. Replies are bounded to 4 KiB;
  incompatible replies, connection failures and cancellation close the socket.
- The existing worker's socket has mode `0600`. The server must run under a user
  with access to the installation and socket. Only trusted installations should be
  configured: **Iniciar modelo** executes that installation's launcher.
- The server runs `model.sh _serve` as a direct child. This uses the existing
  resident process and singleton lock, but retains an exact child handle instead
  of the detached process created by `model.sh start`.
- On shutdown or an idle path switch, only that owned child receives termination
  signals. PIDs returned by external sockets are never signaled. A worker started
  separately with `model.sh start` remains under its original operator's control.
- Startup and status failures never block the HTTP server or musical scheduling.
  The generic preference socket cannot bypass the dedicated validation route.

## Verification

```sh
npm run typecheck
npm test
npm run build:server
npm run build:client
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:tts:e2e
KARAOKE_E2E_MODE=development PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:tts:e2e
```

The browser harness uses an isolated database, real admin login and Unix-socket
worker fixtures. It checks permissions, invalid paths, keyboard controls,
390/1440px layouts, busy-worker handoff, persistence, automatic restart and owned
process cleanup. Screenshots and logs are saved in its printed artifact directory.

An optional real-installation check loads the existing model and queries status:

```sh
KES_TTS_TEST_INSTALLATION=/path/to/chatterbox-latam-test \
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:tts:e2e
```

It generates no audio. It stops a model it started itself and preserves an already
running external model. This check does not certify synthesis quality, latency
under musical load or physical venue audio.

### Block 1 verification results

| Check | Result |
| --- | --- |
| Typecheck and server/client builds | Passed; existing browser-data, license and bundle-size warnings remain. |
| Full unit/integration suite | 482 tests in 56 files passed (baseline: 467 tests in 54 files). |
| Changed-file lint and whitespace check | Passed. Global lint baseline has 28 existing errors elsewhere. |
| Production browser checks | Four scenario groups passed; artifacts `ke-tts-e2e-0k3xfX`. |
| Development / StrictMode browser checks | Four scenario groups passed; artifacts `ke-tts-e2e-9vv6ns`. |
| Real Chatterbox installation | Startup, ready response and owned-process shutdown passed in the isolated production test. No synthesis requested. |
| Responsive inspection | Final 390px and 1440px screenshots inspected; keyboard submission, checkbox and start actions passed. |

The recorded browser artifacts are under `/tmp/opencode/` on the test machine.

## Block 2: prepare greeting audio

1. Configure Chatterbox in **Voz local** and check that the model is ready.
2. Enable **Preparar voz mientras los pedidos esperan** for the current room.
3. Submit a song request with its optional greeting. Preparation starts after the
   musical request is approved, while it is waiting in the queue.
4. The existing song card reports **Voz en espera**, **Generando voz**,
   **Preparando audio**, **Audio preparado**, or **Solo pantalla**. Expand
   **Detalle de la voz** to see an availability/failure reason.

Only the greeting's recipient, message and sender are sent to Chatterbox. Catalog
introductions, karaoke announcements and ambience are not generated by this queue.
The prepared audio is stored for the optional reader described in block 3;
requesting, displaying or removing a greeting continues to work even if the voice
service fails.

Saving preparation/reading settings and refreshing their state allow up to five
seconds for server confirmation; saving does not wait for Chatterbox generation.
While saving, the control shows **Esperando la confirmación del servidor…**. If
confirmation is missing, check the refreshed checkbox state before repeating: the
server may already have saved the change. Player commands keep their shorter deadline.

### Preparation and recovery rules

| Area | Behavior |
| --- | --- |
| Activation | Opt-in per room, disabled on migration. Pending song approval and paused greetings do not trigger synthesis. |
| Capacity | One generation/validation at a time, at most ten unfinished unique jobs. Requests exceeding capacity retain visual delivery and can be prepared when capacity becomes available. |
| Persistence | Migration 020 adds `greetingAudioJobs`, the greeting-to-job reference and the room preparation option. SQL enforces a single generating/preparing/uncertain job. |
| Cache | SHA-256 over room, normalized complete greeting and voice profile. Matching requests share the file while retaining separate identities. Cache hits verify the stored bytes. |
| Profile | Model identity, connection revision, launcher/inference script hashes, reference-audio checksum, fixed seed and processing revision. Saving connection settings creates a new revision. Restart the resident model after changing installed model weights/code. |
| Reference voice | The installation's `reference/es_mx_f1.wav` must already exist. A private immutable copy is passed explicitly to the worker, avoiding its implicit reference download. |
| Validation | Real media parsing and FFmpeg decoding/normalization; up to 20 seconds of greeting audio, 20 MiB raw input and 5 MiB prepared MP3. Catalog voice clips retain their separate ten-second limit. |
| Cancellation | Withdrawn requests, consumed turns, room closure, paused/disabled preparation and stale profiles invalidate pending results. Cancelling a request does not pretend to stop CPU inference. |
| Uncertain generation | Preserve the original installation/attempt and confirm worker readiness or absence before freeing the generation slot. One retry is allowed while the greeting remains eligible. Invalid audio and explicit model rejection use visual delivery. |
| Restart | In-flight jobs become uncertain; queued jobs and ready cache survive. Services finish before SQLite closes. An external worker may continue after shutdown, so recovery waits for it. |
| Retention | Terminal/ready jobs older than 30 days are cleaned when no pending/active greeting references them. Expiring a cache entry claims it before deleting files so a new request cannot attach during cleanup. |

The worker never holds a musical request transaction open. It prepares audio in
`KES_PATH_DATA/greetings`, publishes validated files atomically and keeps temporary
reference/WAV/metadata files until the corresponding inference is known to have
finished. Deleting a room retains an in-flight job's recovery barrier with a null
room reference; it cannot become available to another room.

`GET /api/greetings/:greetingId/audio` serves validated bytes only to an administrator
in that greeting's room while its request and preparation remain eligible. Responses
prohibit caching (`no-store`, plus `private` in production). The route respects
`KES_URL_PATH`; audio is neither listed in the public catalog nor returned to
participant browsers.

### Block 2 verification

```sh
npm run typecheck
npm test
npm run build:server
npm run build:client
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:greetings:audio
KARAOKE_E2E_MODE=development PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:greetings:audio
```

The dedicated harness uses real QR admission and request forms, SQLite, Unix-socket
worker fixtures, FFmpeg, private HTTP audio and browser decoding. It checks shared
audio, cancellation, interrupted external-worker recovery, ready-cache persistence
and visual delivery followed by real local MP4 playback when synthesis fails.
YouTube metadata is a fixture; live YouTube is not required or certified.

Unlike the block-1 status-only harness, the following opt-in test generates **one
real greeting** with the local model and stores `real-greeting.mp3` in its isolated
artifact directory. It does not play the generated voice publicly:

```sh
KES_TTS_TEST_INSTALLATION=/path/to/chatterbox-latam-test \
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:greetings:audio
```

### Block 2 verification results

| Check | Result |
| --- | --- |
| Typecheck and builds | Passed; existing client build warnings remain. |
| Full unit/integration suite | 501 tests in 57 files passed; includes 19 dedicated preparation/recovery tests. |
| Lint | No new findings. Global lint retains its 28 baseline errors, including the existing `any` in `server/main.ts`. |
| Production E2E | Four scenario groups passed; artifacts `g-audio-e2e-5lyuj2`. |
| Development / StrictMode E2E | Four scenario groups passed; artifacts `g-audio-e2e-oP4WFR`. |
| Real Chatterbox generation | Passed; a 3,475 ms greeting was generated and validated in `g-audio-e2e-FlRAuy/real-greeting.mp3`. |
| Responsive and keyboard checks | Preparation settings and queue states inspected at 390/1440px; participant cards and visual fallback inspected; keyboard activation passed. |

Artifacts are under `/tmp/opencode/` on the test machine. The real-model check
validates generation and media, not pronunciation approval, physical PA playback
or latency under live venue load. Playback coverage is documented below.

The preparation-settings timeout regression adds 2.2-second delays separately to
the outgoing command and incoming acknowledgement. Five preparation E2E groups
passed in development/StrictMode (`g-audio-e2e-oOTLtn`) and production
(`g-audio-e2e-s5q8TT`), with keyboard toggles and 390/1440px screenshots. Six client
request tests and four server permission tests also passed, along with typecheck,
focused lint and the client build. These follow-up runs use the socket worker fixture.

## Block 3: intro, greeting and song

### Use the reader

1. In **Ajustes → Animador → Voz local**, enable **Leer saludos en voz alta** for
   the room. This also enables preparation. Preparing audio alone never enables
   public reading.
2. Choose **Presentación del saludo** from available catalog voices, or keep
   **Sin presentación**. Use a generic introduction: singer names and tables are
   displayed, not dynamically synthesized. The selected introduction is reserved
   for greetings and excluded from general automatic announcements in that room.
3. Enable **Acompañar la lectura con ambiente suave** to reuse an available ambient
   resource matching the room profile. The voice also works when no bed is ready.
4. Use the normal player controls. If the browser genuinely blocks audio, the
   player explains the required interaction. A pending greeting still has visual
   delivery; it does not hold the music while waiting for synthesis.

Each request's transition is **catalog introduction → complete greeting → song**,
with a quiet bed beneath the voices. Two greetings in a two-song turn now produce
**X → song A → Y → song B**. Canonical turn membership, FAIR/FIFO rotation and the
request-time greeting window remain in place; this change does not allow attaching
a message after a musical request has already been submitted.

### Singing versus listening

The request form explicitly sends **Cantar karaoke** or **Escuchar música**. New
forms conservatively default to listening; local library rows offer the same
choice and support keyboard submission. Retries retain the original intent with
the request receipt. House playback is listening; older requests without an intent
remain `UNKNOWN` and receive neutral presentation rather than a guessed singer.

The player displays the intent, participant name and table from the accepted
request. The greeting recipient remains separate from the singer. Chatterbox
continues to receive only the greeting's recipient/message/sender; it never
generates a karaoke introduction or table announcement.

### Timing and ownership

- The player has a **25-second transition deadline**, including its bounded audio
  activation handshake. Plans use measured asset durations and reserve startup/fade
  margin. If the introduction does not fit, the complete greeting takes priority.
  Speech is never truncated or accelerated to fit; unready or ineligible voice uses
  the visual card instead.
- Greeting startup allows three seconds within that same deadline. Without an
  introduction, the visible-card validation and audio-start confirmation require
  two network round trips; the generic animator's one-second permit was too short
  on a remote connection. Plans reserve that startup time before selecting an intro.
- A voiced card shares the speech duration, with only a three-second readability
  minimum for very short clips. It does not add the visual-only 10–15 second
  interval after speech; the background fade is the final short tail.
- A maximum-35-second ambient file is not a 35-second pause. A second source/gain
  plays only the needed segment, fades out, and finishes before the next media
  element starts. The bed gain is capped at the lower of the room ambience volume
  and 40% of its voice volume. Physical levels still need venue calibration.
- Greetings reuse `animationInterventions` with origin `GREETING`, the existing
  authoritative socket/epoch, one-active-intervention constraint and persisted room
  fence. The intro and bed also benefit from existing in-use resource protection.
- Greeting speech time participates in the existing 120-second/10-minute voice
  budget; visual reading time and bed duration do not. Interrupted or uncertain
  starts are accounted for conservatively.
- Private audio is decoded ahead of the pause in a separate preparation group
  within the existing bounded channel cache. Catalog refresh does not evict the
  imminent greeting. Playback never invokes synthesis.
- Voice completion and visual completion have separate acknowledgments. A closed
  duplicate player cannot stop the authoritative reader. On disconnect/restart,
  an uncertain greeting is not replayed and a successor respects the room fence.
- A paused queue does not consume its greetings during idle animator opportunities.
  Preparation can continue, but delivery requires the intention to play the song.
  A musical command arriving during an idle probe invalidates that transition;
  the player rechecks the pending greeting before advancing under the new intent.
- Failed voice delivery retains the bounded playback error in its stored reason,
  alongside the visual fallback, to distinguish an expired permit from other failures.

The reader has its own room enable switch. Generic animator enable/automation
controls do not authorize or mute it; the shared voice volume affects both. Use
**Retirar saludo**, **Pausar saludos**, the active announcement stop control or the
musical controls to interrupt the current delivery. Disabling preparation also
disables public reading.

Migration 021 stores intent, versioned reading settings, per-song delivery/audio
outcomes and the speech-only duration used for budgeting. The existing turn-membership
table continues to enforce the request window; no second musical scheduler is added.

### Block 3 verification

```sh
npm run typecheck
npm test
npm run build:server
npm run build:client
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:greetings:playback
KARAOKE_E2E_MODE=development PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:greetings:playback
```

`test:greetings:playback` reuses the isolated greeting-audio harness and adds catalog
uploads, public-reader controls, actual Web Audio sources and real local MP4 playback.
Its native-source trace checks that the bed is shortened and every voice/bed has
ended before musical playback. It covers a nineteen-second greeting with its
oversized introduction omitted, active withdrawal, duplicate players and restart.
The remote-connection regression delays each WebSocket direction by 300 ms, starts
playback by keyboard during a pending idle probe, and verifies the entire greeting
without an intro, with both animator and local reading enabled. Native audio events
must show one complete voice source before the song starts.

Set `KES_GREETING_TEST_AUDIO=/path/to/existing-greeting.mp3` to replay an existing
recording in this isolated regression. It is decoded into a local fixture; no new
Chatterbox generation or live-room playback is requested. Screenshots cover 390px
and 1440px after the player viewport has settled.

With `KES_TTS_TEST_INSTALLATION=/path/to/chatterbox-latam-test`, the first pair uses
one real Chatterbox generation shared by two requests and reads it in the isolated
headless player. The remaining stress cases use local fixtures. This is software
playback verification, not physical PA or accent acceptance.

| Check | Result |
| --- | --- |
| Typecheck, builds and focused lint | Passed; existing client build warnings remain. |
| Full suite | 513 tests in 58 files passed, including intent persistence, per-song delivery, shared reservations, budget/fallback and native bed lifecycle. |
| Greeting playback, development | Seven scenario groups passed; `g-audio-e2e-uVBsBg`. |
| Greeting playback, production + real Chatterbox | Seven scenario groups passed; `g-audio-e2e-VKWAID`. Real generated speech was read once for each of two requests. |
| Visual/background-player regression | Six groups each in production `karaoke-greetings-e2e-S88MM8` and development `karaoke-greetings-e2e-bmthOj`. |
| Manual animator regression | Sixteen groups in production `karaoke-animation-e2e-LAm5Zd` and development `karaoke-animation-e2e-s4Jcwy`; the latter also exercises local singing/listening requests by keyboard. |
| Automatic animator/catalog regression | Twenty-three groups passed in production; `karaoke-phase2-e2e-Rzy7Sc`, provider calls simulated. |
| Visual inspection | 390/1440px request forms and reading controls, singer/table card and voice outcomes inspected. |
| Remote-start regression (2026-11-02) | 96 focused unit tests passed. Expired starts remain rejected; failed reads retain their diagnostic. |
| Remote-start playback (2026-11-02) | Nine groups each in development StrictMode `g-audio-e2e-8ayuTT` and production `g-audio-e2e-xPqwGC`, using an existing 5.5-second greeting recording. Full-duration audio, keyboard Play during an idle probe and settled 390/1440px screenshots verified. |
| Musical-command regression (2026-11-02) | Sixteen production animator groups passed in `karaoke-animation-e2e-WuEEYN`, including pause/resume, skip, replay, stop, disconnect and restart. |

Artifacts are under `/tmp/opencode/`. The initial automatic-regression run reached
its outer timeout during the final dialog capture after 22 groups; the harness now
commits keyboard selection and takes a bounded viewport screenshot after verifying
the control is visible. The full subsequent run passed.

## Rollback boundary

Disable greeting preparation for the room to return to visual-only operation.
Clear automatic startup, then shut down the server to release an owned model.
Keep migrations 020 and 021 installed for operational rollback. Binary downgrades that omit
a migration run its Down SQL in this application; use a matching database backup
when reverting binaries. The original block-1 connection alone needs no schema
migration, but block 2 does.
