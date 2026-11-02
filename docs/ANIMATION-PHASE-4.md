# Phase 4 — local greeting voice

## Block 1: connect Chatterbox

The **Voz local** tab in **Ajustes → Animador** connects the karaoke server to an
existing Chatterbox LATAM installation. Block 1 configures and starts the model;
block 2 below prepares private greeting audio. Public voice playback belongs to
the next block. The player currently delivers the visual greeting.

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
The prepared audio is stored for the next playback block; requesting, displaying
or removing a greeting continues to work even if the voice service fails.

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
or latency under live venue load. Public voice playback remains the next block.

## Rollback boundary

Disable greeting preparation for the room to return to visual-only operation.
Clear automatic startup, then shut down the server to release an owned model.
Keep migration 020 installed for operational rollback. Binary downgrades that omit
a migration run its Down SQL in this application; use a matching database backup
when reverting binaries. The original block-1 connection alone needs no schema
migration, but block 2 does.
