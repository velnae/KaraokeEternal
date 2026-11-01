# Phase 4 — local greeting voice

## Block 1: connect Chatterbox

The **Voz local** tab in **Ajustes → Animador** connects the karaoke server to an
existing Chatterbox LATAM installation. This block configures and starts the model;
greeting synthesis and public playback belong to the following blocks. Greetings
currently retain their visual delivery.

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
| Sin conexión | No worker is accepting connections; select **Iniciar modelo**. |
| Requiere atención | Review the installation/permissions and retry **Comprobar conexión**. |

A path change is saved immediately but waits for the current worker's response
before activation. A timeout does not prove that inference stopped: the old path
remains active and the pending change remains visible. Checking again can complete
the switch once the worker responds. Existing external workers are left running.

## Runtime contract

- Uses newline-delimited JSON over `<installation>/.tmp/model.sock`. This block
  sends only `{"action":"status"}` and expects a ready status with a positive PID.
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

## Rollback boundary

Clear automatic startup, then shut down the server to release an owned model.
The feature can be removed by reverting the local TTS modules/routes, startup hook
and **Voz local** UI. The unused preference can remain in SQLite; no schema
migration or greeting/music data removal is required.
