# Manual announcements: phase 1

An administrator can request one short local clip for the next safe gap, stop
it, or mark the microphone occupied. The authoritative room player emits the
voice and matching text. Music ordering remains in the existing player.

## Try it

1. Build and start the server using the project's existing commands. Migration
   `010-animation.sql` creates the two animation tables. Back up the database
   before deploying a schema change.
2. Sign in as an administrator in a room. Open **Cola → Animador** and enable it.
3. Open `/player` on the venue computer. Audio prepares and activates automatically
   when autoplay is allowed. If blocked, use **Reproducir** or **Permitir sonido**
   in that player tab. A remote phone cannot grant that tab's audio permission.
4. Select a demo clip and click **Anunciar en la próxima pausa**.
5. While a song is playing or paused, the request waits. A natural ending or an
   empty player allows the clip. The next song remains approved until the voice
   finishes. A clip that is not ready does not delay the next song.

Once the animator is enabled and a room player is connected, a request can be
saved **before audio is unlocked or prepared**. The panel explains that it is
preparing automatically, with a local gesture needed only if autoplay is blocked. Request acceptance does
not authorize immediate playback. Other blockers (no player, microphone in use,
zero voice volume, recovery or a closed room) include a visible next step.

The three bundled demo clips are explicitly labelled as test voices. Their
provenance is in `assets/animation/README.md`. Listening and calibration on the
actual business speakers are still required before accepting the phase.

## Operator controls

| Control | Result |
| --- | --- |
| Cancel request | Cancels a pending request. |
| Stop announcement | Requests a stop; completion is shown only after player confirmation. |
| Microphone occupied | Blocks new voice and stops a running announcement; does not control microphone hardware or pause music. |
| Voice volume | Independent of music; zero stops voice rather than recording silent delivery. |
| Animator off | Cancels pending voice and stops the active clip. |
| Music Next / Replay | Overrides the announcement and executes the musical command. |
| Music Pause / Play | Stops the announcement and respects the latest musical intent. |

A paused or loading song is **not** an eligible gap. An uncertain playback
result is never replayed automatically. Reconnect restores state, not old
commands. Microphone state survives server restarts.

## Small operational limits

- Disabled by default; voice volume starts at 50% and must be calibrated.
- One pending/active request per room; pending requests expire after 10 minutes.
- Clips must decode successfully and be at most 10 seconds long.
- Reservation arbitration has a one-second budget. Files are prepared first.
- A successor player respects the previous grant's bounded exclusion window,
  including before starting music. Missing confirmation is recorded honestly.

## Catalog administration

Edit `KES_PATH_DATA/animation/catalog.json` and restart the server to activate a
reviewed catalog. Entries use the format in `assets/animation/catalog.json`.
Each active entry needs an ID, title, displayed text, relative filename, source
and license/provenance note. An optional `checksum` must match SHA-256.

Supported formats: WAV, MP3 and Ogg, up to 5 MiB per file and 30 catalog entries.
Paths and symbolic links must stay within the catalog directory. Invalid
entries are omitted with a server warning. Files are served to authenticated
administrators through the existing application base URL. A modified disk file
cannot replace a currently decoded clip mid-announcement.

## Verification

```sh
npm run typecheck
npm test
npm run build:server
npm run build:client
# Set this only when using a system Chromium rather than Playwright's browser.
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:animation:e2e
# Exercise source code, React StrictMode and development-only cleanup cycles.
KARAOKE_E2E_MODE=development PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:animation:e2e
```

The E2E harness starts a temporary server/database under `/karaoke/`, generates
a short local MP4 with FFmpeg, and exercises real Chromium audio and multiple
player tabs. It retains screenshots and the isolated server log in its printed
temporary evidence directory. It does not modify the running venue database.
The normal music flow queues songs through the library UI with animation off,
then tests play/pause/resume, volume, leaving/reentering the player, skip,
natural queue exhaustion and adding music again. Output analyser probes check
nonzero audio after the gain stage and silence on pause/mute, not just video
position. Both production and development runs are required: production alone
does not exercise StrictMode's setup-cleanup-setup lifecycle.

Unit/integration tests cover state transitions, duplicate requests and events,
permissions, stale commands, queue context, expiry, microphone controls,
restart fencing, catalog validation and preservation of unrelated settings.
Browser tests cover the operator panel, local music transitions, cancellation,
microphone/disable controls, standby players, replay, pause during voice,
audio-context suspension and recovery. Physical sound
output and live YouTube network conditions require a separate venue check.

### Implementation verification record

- `npm run typecheck`: passed, including the player-component typing and exported
  Redux state types needed by the existing composite TypeScript project.
- `npm test`: 304 tests passed in 40 files, including request availability,
  cold-start and audio
  lifecycle regressions.
- Server and client builds: passed. Existing bundle/license warnings remain.
- Chromium E2E: all 15 scenarios passed in each mode, with no page errors or
  duplicate audio-context closes. Temporary evidence directories:
  production `/tmp/karaoke-animation-e2e-DjbPv0`, development
  `/tmp/karaoke-animation-e2e-Ca3nrn`. Includes requesting/cancelling by keyboard
  before audio unlock, volume/microphone recovery, and inspected layouts at
  320, 390, 768 and 1440 pixels. Width assertions also catch squeezed content,
  rather than checking only document overflow.
- Table/QR regression E2E: all 17 scenarios passed, with no page errors.
- Repository lint had 28 pre-existing errors at baseline, primarily explicit
  `any` types in older server modules. New animation code is checked separately.
- Physical speaker calibration, production voice approval, live YouTube checks
  and user acceptance: pending. These are not inferred from headless tests.

## Automatic audio activation verification (2026-11-01)

The player prepares clips before permission is granted and tries autoplay when
enabled. Normal trusted clicks/keys in the authoritative player tab also resume
the channel. **Permitir sonido** appears only after resume fails or remains
suspended for 750 ms; **Reintentar audio** recovers preparation errors. Readiness
is scoped to the current room, player epoch and socket connection.

- `npm test`: **467 tests passed**, including 13 audio lifecycle tests.
- Typecheck, scoped lint, server/client builds and `git diff --check`: passed.
  Full repository lint still reports 28 errors in unchanged files.
- Restrictive Chromium autoplay: **16 scenarios passed in both modes**, including
  pending requests from another tab, normal keyboard activation, suspension,
  takeover, reconnect and no replay. Production evidence:
  `/tmp/karaoke-animation-e2e-Jy8CYU`; development:
  `/tmp/karaoke-animation-e2e-16FZg7`. Recovery screenshots inspected at 390/1440 px.
- Allowed autoplay and catalog: **23 scenarios passed in both modes**. Readiness
  is confirmed while `navigator.userActivation.hasBeenActive` is still false.
  Evidence: `/tmp/karaoke-phase2-e2e-UEN1I0` (production),
  `/tmp/karaoke-phase2-e2e-Y6poDS` (development/StrictMode).
- Real-catalog 12-song rehearsal: **7 checks passed in each mode**; evidence:
  `/tmp/karaoke-real-rehearsal-HY5oE1` and `/tmp/karaoke-real-rehearsal-cKtErF`.

Run browser scripts with `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium` on
this machine; add `KARAOKE_E2E_MODE=development` for StrictMode. The rehearsal
also needs `KARAOKE_REHEARSAL_DATA` pointing to the existing catalog to copy.
Provider responses are simulated in catalog tests; rehearsals use isolated
copies of real files. Physical listening and other browsers remain unverified.

**Harness detail:** Playwright DOM assertions can grant Chromium activation.
Before the deliberate gesture, restrictive tests use CDP `Runtime.evaluate`
with `userGesture: false` and `Page.captureScreenshot`. Wait for resized player
bounds before capturing mobile screenshots.

The autoplay work unit consists of `AnnouncementAudio` resume/prepare changes,
`useAnimationPlayer` activation/readiness, the player/operator recovery copy,
and their tests/docs. Reverting it should restore the dedicated unlock flow
without reverting catalog rotation, resource management or server automation.

## Rollback boundary

Turn the animator off and wait for a confirmed stop or the bounded exclusion
window to expire. Music continues through the original selector and players.
Keep the animation tables/history; disabling the module needs no destructive
schema rollback. Before deploying an older binary, stop voice and stop the
server. Restore the corresponding database backup if that binary cannot use
the newer migration history. Never downgrade while an announcement may still
be playing.

Phase 2 begins only after the operator validates and accepts this delivery.
