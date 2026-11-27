# Diagnose playback and reproduce it locally

Use `npm run diagnostics -- help` or the OpenCode `/karaoke-diagnose` command.
The tools collect a private evidence bundle and run existing isolated regression
scenarios. A scenario passing is **not** proof that the reported incident was reproduced.

## Quick path: local only

```sh
mkdir -p .diagnostics
npm run diagnostics -- init .diagnostics/voice-cut "Animator stops early" "Voice completes before automatic music starts"
npm run diagnostics -- inspect-release .diagnostics/voice-cut
npm run diagnostics -- assemble .diagnostics/voice-cut transitions
npm run diagnostics -- run .diagnostics/voice-cut development
npm run diagnostics -- report .diagnostics/voice-cut
```

Use a new bundle directory for each investigation. Evidence files are private,
uniquely named and never overwritten. Keep bundles under ignored `.diagnostics/`.
The manifest contains the symptom and expected behavior; avoid personal data there.

| Scenario | Contract exercised |
| --- | --- |
| `transitions` | Voice/bed sequencing, music handoff, explicit pause, background failure and cleanup (excludes the unrelated queue-presentation checks) |
| `delayed-ack` | Full audio sequence and YouTube preparation with delayed acknowledgments |
| `late-playback-receipt` | Six-second voice with STARTED/ASSET_STARTED receipts delayed 1.8 seconds; confirmed playback must finish despite a late asset receipt |
| `slow-link` | 600 ms each way on the browser WebSocket; voice, ambience and effects must survive the full startup handshake, natural boundaries and explicit controls |

All scenarios create temporary databases, synthetic resources and local servers on reserved
ports. The runner removes inherited `KARAOKE_*`, `KES_*`, `DEV_PLAYER_*` and
`NODE_OPTIONS` settings, forces local fixture mode and disables provider keys.
It does not load `.env`, change the shared development database or deploy anything.
Run logs identify the suite's additional artifact directory (screenshots and logs).
Keep that directory while investigating; it is not embedded in the bundle.

Production-mode reproduction means an **isolated local production build**, not
the VPS. Compile current sources before using it:

```sh
npx --no-install tsc -p config/tsconfig.server.json --noEmitOnError
mkdir -p build/server/lib
cp -R server/lib/schemas build/server/lib/
NODE_ENV=production npm run build:client
npm run diagnostics -- run .diagnostics/voice-cut production
```

Do not infer build freshness from the current Git revision. The runner records
the scenario result, not a claim that a preexisting compiled build matches Git.

## Reproduce late name and greeting receipts

```sh
mise exec node@24.22.2 -- env PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium \
  KARAOKE_E2E_MODE=development KARAOKE_E2E_GREETING_PLAYBACK=1 \
  KARAOKE_E2E_GREETING_RECEIPTS=1 node config/greeting-audio.e2e.mjs
```

This isolated scenario delays `STARTED` receipts by 3.5 seconds and
`ASSET_STARTED` receipts by 1.8 seconds. It checks complete, exactly-once intro,
greeting and name audio against native audio-clock duration, then verifies that
an explicit server rejection still stops playback. No real provider is used.
Use `KARAOKE_E2E_MODE=production` after rebuilding for the compiled variant;
omit `KARAOKE_E2E_GREETING_RECEIPTS` for the full cancellation/restart suite.

A ready greeting without its name attribution remains visual-only and reports
`Falta la voz del nombre. Revise Animador → Nombres.` An uncertain first name
generation requires explicit generation and selection in that panel; transitions
do not silently retry paid synthesis. Once selected, the audio is reused.

## Capture the affected player

The instrumented player retains its latest 300 technical events in memory.
It makes no telemetry requests and stores no cookies, speech text, names or
socket IDs. Reloading loses the ring. Export promptly after an incident.

In the **affected tab's** browser console:

```js
copy(JSON.stringify(window.karaokePlaybackTrace.snapshot(), null, 2))
```

`copy` is a Chrome DevTools helper. Save the copied JSON to a private local file.
With Playwright already attached to that tab, evaluate instead:

```js
() => window.karaokePlaybackTrace.snapshot()
```

Then import it:

```sh
npm run diagnostics -- import-player .diagnostics/voice-cut /path/to/player-trace.json
```

Opening another browser does not expose the original tab's history. Older builds
will not have this export until the instrumentation is deployed normally.
The export has no commands to start, stop or otherwise control playback.

### Automatic incident capture in development

On the affected development `/player` tab, export the latest captured incident:

```js
copy(JSON.stringify(window.karaokePlaybackTrace.incidents()[0], null, 2))
```

The browser keeps up to three recent captures for 30 minutes in the tab's session
storage, including after a reload in that tab. Use `snapshot()` for a live trace
when there is no automatic capture. Import either export with `import-player`.
Use the `diagnosticId` to match the development server's `[transition]` logs for
slow or unsuccessful reservation requests. The capture also records scene
phases, background readiness and the incoming player's actual start. No extra
diagnostic traffic or storage is enabled in production.

Events include audio start/finish, cancellation reason, gain muted, context state,
intervention identity, relevant commands, connection loss and music start. Audio
start records the scheduled duration; finish records both monotonic elapsed time
and audio-clock elapsed time. Neither measures physical speaker output.
Some generic callers still report `explicit-stop`; do not invent a more specific
cause. Background-bed lifecycle is covered by the existing E2E probes, not fully
by this foreground trace.

## Collect production evidence when requested

Only after an explicit production-read request, supply a UTC window of at most
one hour and the room ID:

```sh
npm run diagnostics -- collect-server .diagnostics/voice-cut \
  2026-11-08T20:00:00Z 2026-11-08T20:15:00Z 1 --production-read
```

This runs a fixed Python collector through `ssh karaoke`: active-release
fingerprints, service state, up to 500 journal lines and up to 100 intersecting
interventions through SQLite `mode=ro` and `query_only`. No remote files are
created. There is no sudo fallback, arbitrary remote command or SQL argument.
Lack of journal access or missing schema fields is reported under `gaps`.
The collector also projects audio enablement/volumes, persisted animation fences,
the three latest sessions and ten latest queue statuses for the selected room.
It excludes room names, queue titles and full settings. Journal lines are stored
as an array; UTC ISO input is normalized for older systemd timestamp parsers.
The flag is an execution guard; it does not replace user authorization.

The active release path and hashes are evidence. The collector does not assume
the Plesk checkout revision is deployed. Compare matching source fingerprints
with `inspect-release`; capture the loaded browser JS filenames separately when
investigating stale tabs. Old releases do not necessarily have a commit marker.

Journal credential masking is best effort, **not anonymization**. Treat server
bundles and raw browser exports as private; review before sharing. Do not import
HARs, cookies, localStorage, full databases or `.env` files into the bundle.

## Interpret and reproduce

1. Match intervention IDs and checksums. Within one tab, order by `sequence` and
   measure intervals using `monotonicMs` or the audio clock.
2. Use `wallTime` only to locate the server window. Record clock skew uncertainty;
   do not subtract browser and server clocks as if synchronized.
3. Inspect `audio-stop-request` and `audio-finish`. Distinguish a scheduled end,
   explicit command, lost authority, missing acknowledgment and context loss.
4. Select a scenario with `assemble`. It creates a validated recipe, not an
   automatic replay of arbitrary captured events. Extend the corresponding
   fixture with the observed timing/configuration when needed.
5. Establish a failing assertion before fixing the incident. Run the same
   scenario after the change; record remaining differences from production.

For improvements, use the expected behavior as the scenario's acceptance
condition. Do not label an intentional behavior change a reproduced defect.

`report` outputs evidence with SHA256 hashes. Preserve `droppedEvents`, `gaps`,
missing captures, nonzero exit codes and `incidentReproduced: not-established`.
The last value is deliberate: only a demonstrated failing scenario establishes
reproduction. A ten-minute runner timeout is a failure, not a passing test.

HTTPS smoke tests use **https://dev-karaoke.puyu.pe/**. The two supported suites
also offer `KARAOKE_E2E_HTTPS_UI=1` outside this local-only runner, forwarding API
and socket traffic to isolated fixtures. Never substitute the production host.
