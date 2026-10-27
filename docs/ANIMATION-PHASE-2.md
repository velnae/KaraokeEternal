# Phase 2: produce, approve and automate the room catalog

Phase 2 adds an ElevenLabs production workflow, explicit operating sessions,
event-based announcements and interruptible background ambience. It extends
the phase 1 coordinator and player rather than replacing musical scheduling.

## Server configuration

Back up the database before deploying. Migration `011-animation-production.sql`
adds generation jobs, operating sessions and the metadata needed for automatic
events and finite ambience permits.

Configure these environment variables on the **server**. Never put the API key
in the browser, catalog manifest or a committed configuration file.

| Variable | Default / purpose |
| --- | --- |
| `KES_ELEVENLABS_API_KEY` | Required to generate; existing local playback does not need it. |
| `KES_ELEVENLABS_VOICE_ID` | Optional initial voice; the UI can choose an available account voice after checking the connection. |
| `KES_ELEVENLABS_MODEL` | `eleven_v4` for announcer speech. |
| `KES_ELEVENLABS_CHARACTER_LIMIT` | `10000` reserved/consumed speech characters per UTC calendar month, across the installation. |
| `KES_ELEVENLABS_EFFECT_SECONDS_LIMIT` | `300` reserved/consumed effect seconds per UTC calendar month. |
| `KES_ELEVENLABS_PRICE_PER_1K_CHARS` | Optional configured USD estimate per 1,000 speech characters. |
| `KES_ELEVENLABS_PRICE_PER_EFFECT_SECOND` | Optional configured USD estimate per effect second. |
| `KES_FFMPEG_PATH` | `ffmpeg`; used to validate signal and normalize generated audio. |
| `KES_ELEVENLABS_BASE_URL` | `https://api.elevenlabs.io`; only change for a trusted regional provider endpoint or an isolated test fixture. |

The application checks the account's models and voices before accepting a new
generation. Voice uses `POST /v1/text-to-speech/{voice_id}` with v4 and supported
stability/similarity settings. Effects and ambience use
`POST /v1/sound-generation` with `eleven_text_to_sound_v2`; ambience requests
loopable output. No Style/Speed slider or SSML is sent to the speech model.

FFmpeg is required for **production**, not for playback of existing files.
Missing credentials or processing support have a visible explanation in the UI.

## 2A — Produce and review

1. In **Ajustes → Animador → Conexión y consumo**, verify the connection.
2. Open **Audios** and select a voice, family, interpretation and allowed room profiles. For effects
   or ambience, enter a sound description and requested duration instead.
3. Generate one resource or a batch of three distinct prepared texts. The UI
   shows the text/units and estimated cost when a tariff has been configured.
4. Wait for **Pendiente de escucha**. Generation is asynchronous, persistent and
   limited to one concurrent job. Identical requests reuse the same job.
5. Use a separate monitoring output, listen and approve each file. Preview is
   local to the reviewing device and does not create public playback history.
6. Publish. The player prepares new resources before they become eligible.

Verified account voices are restored when returning to or reloading this page;
`KES_ELEVENLABS_VOICE_ID` is optional. **Última solicitud**, beside the generation
button, tracks the submitted resources through preparation, review or failure.
Its job IDs are retained in this browser tab, scoped to the account and room;
the server remains authoritative for their state. Leaving Settings does not
cancel generation. Returning or reloading restores the latest tracked result.
Resubmitting an identical failed/uncertain resource shows its existing result
instead of silently issuing another paid request. Use an explicit new revision
when another attempt is intended. Provider rejection codes and audio-duration
failures have actionable messages without echoing provider response content.

Generated files are private until publication. The worker checks decoding,
useful signal and measured duration, then normalizes voice/effects/ambience to
initial targets of −16/−20/−24 LUFS with −1 dBTP. These are processing targets,
not physical loudness measurements. Clips outside the allowed duration are
rejected, not truncated or sped up.

Limits: voice ≤10 seconds, effect ≤3 seconds, ambience ≤30 seconds; at most nine
resources per generation batch. A promotion must have an explicit future expiry.
Published resources may be deactivated/reactivated without a new paid generation.

Jobs retain model, voice, text, interpretation, revision, units, estimate and
provider request ID when available. A deliberate regeneration uses a new revision.
Timeout/server failures after sending a request can be **inciertos**: they are
not retried automatically. A restart also preserves that uncertainty. Rejected
or unsuccessful attempts that reached the provider still count conservatively
against the configured production limit. The estimate is not a provider invoice.

The included pilot text library contains three variants for presentation,
closing, invitation, welcome, goodbye, celebration and booth families. Original
phase 1 demo clips remain manual-only until explicitly reviewed for automation.
Personalized customer greetings are not part of this external generation path;
their local TTS integration belongs to the later greetings phase.

## 2B — Automatic operation

1. In **Ajustes → Animador → Funcionamiento**, enable the animator, choose **Automático**, and select **Cena**, **Mixto** or
   **Fiesta**.
2. Open the venue player and enable its audio with a local user gesture.
3. Click **Iniciar jornada**. Reconnects and refreshes do not open another session.
4. Configure the desired event families under **Eventos y ambiente de pausas**.

The player remains responsible for FAIR/FIFO ordering and house/operator tracks.
At a real boundary, the backend selects an approved, prepared resource and uses
the existing bounded reservation. Manual pending requests take precedence.
Only confirmed starts consume repetition history. Uncertain starts are treated
conservatively and are not replayed.

| Event | Behavior |
| --- | --- |
| Explicit session opening | One welcome opportunity, valid for two minutes. |
| Confirmed next track at first start or natural boundary | Generic introduction. |
| Natural ending without a more relevant introduction/event | Neutral closing. |
| Eligible idle room | Invitation/booth/promotion according to interval and limits. |
| Operator-confirmed celebration | Celebration voice and an optional approved celebration effect outside Dinner mode. |
| Explicit session closing | Farewell opportunity for up to 60 seconds; closure never holds music indefinitely. |

Next, replay and playback errors do not become natural-end announcements.
Stable event keys include the operating session and source/target queue item,
not a fresh browser render UUID. There is one voice intervention per pause, with
at most one optional effect; automatic opportunities are not accumulated into
an old-message backlog.

The rolling 120-second/10-minute intervention allowance includes manual voice
and effects conservatively. A valid manual request can wait for the allowance
to become available without blocking songs. Environmental voice intervals are
20/12/8 minutes for Dinner/Mixed/Party. Booth limits are 0/1/2 per operating
session, with a one-hour separation in Party. Promotions expire and are limited
to one per hour. Environmental phrases do not repeat in the current session;
the selector prefers variants absent from the two preceding sessions. Turn
phrases favor less used/older variants and do not repeat the last spoken text,
even when another style produced that same wording.

Operating dates use `America/Lima` and a configurable cutoff (initially 04:00).
Opening a session, changing profiles, midnight or restarting do not erase history.

## Administration navigation

Administration uses a full-width workspace with a desktop sidebar and a
collapsible menu on tablet/mobile. The queue contains musical operations only.
Stop-announcement and microphone controls remain in the player and animator
settings; opening a settings page does not remount the separate venue player.

| Section | Route |
| --- | --- |
| Queue / library | `/queue`, `/library` |
| Rooms and tables / users | `/admin/rooms`, `/admin/users` |
| Animator | `/admin/settings/animator` |
| Playback / files / venue branding | `/admin/settings/playback`, `/admin/settings/files`, `/admin/settings/branding` |
| Account and software information | `/admin/account` |

Animator areas use `?view=operation`, `?view=audio` and `?view=connection`, so
browser Back/Forward and reload preserve the selected area. Switching areas
retains the production form; leaving the page stops local monitoring audio but
does not stop server jobs or close the operating session. The preparation guide
reflects connection verification, published catalog, player audio and session
state rather than storing a separate onboarding-completion flag.

Old `/account#admin-*` and `/queue#animator` links redirect to their corresponding
sections. Direct links work under a configured URL prefix such as `/karaoke/`.
Participants cannot enter administrative routes or access production APIs.

## 2C — Pause ambience

Enable **Sonido de pausa** and set its independent volume. It requires an open
operating session, automatic mode and prepared approved ambience.

Ambience has a finite authority permit for at most ten seconds of playback at
a time. It may continue in subsequent segments while the room stays eligible,
but does **not** reserve or delay the next song. It yields to voice, music and
microphone use; resumes only if still idle; stops on disconnect or lost authority.
A successor respects an unconfirmed previous permit until it expires. A paused,
loading or errored song is not an idle room. Ambience is not counted as spoken
history or voice budget.

## Verification against the approved design

The repository includes `Production.test.ts`, `selection.test.ts`, extended
coordinator tests and a dedicated browser harness. The HTTP provider in automated
tests is simulated; FFmpeg, SQLite, authenticated routes, Chromium audio and
browser interactions are real.

```sh
npm run typecheck
npm test
npm run build:server
npm run build:client
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:animation:phase2
KARAOKE_E2E_MODE=development PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:animation:phase2
```

| Requirement | Verification |
| --- | --- |
| Voice v4 and specialized effects/loopable ambience | HTTP integration + browser production/review workflow; simulated provider. |
| No paid generation on playback | Browser fixture counts provider calls before/after automatic playback. |
| Deduplication, revision and budget control | Production integration tests; atomic batch rejection. |
| Invalid/corrupt/silent/overlong audio never published | FFmpeg-backed production tests. |
| Review before publication, room isolation, private credentials | Production tests and authenticated UI workflow. |
| Explicit sessions, stable events, no welcome on reconnect | Coordinator persistence/restart tests and browser opening/closing. |
| Natural endings versus skip/replay | Automatic browser flow and existing player regression suite. |
| Manual priority, stale context, budget and closing timeout | Coordinator tests; rolling-budget recovery in browser. |
| Persistent variety, profiles, promotions and business date | Pure rule tests with controlled timestamps. |
| Ambient preemption, renewal and owner takeover fence | Coordinator tests and browser overlap instrumentation. |
| Real ElevenLabs voice quality, account access and billing | Pending live account test; not established by a mock provider. |
| Venue sound output and monitoring separation | Pending physical listening/output validation. |

### Executed checks

- `npm run typecheck`: passed.
- `npm test`: **335 tests passed in 42 files**.
- Lint for the changed animation, production and integration files: passed.
  The previously documented repository-wide legacy lint findings are separate.
- Server and client builds: passed.
- Phase 2 Playwright: **11 scenarios passed in development and production**,
  with no page errors. Each run made 21 POST requests to the isolated fixture
  provider; none were real ElevenLabs generations.
- Phase 1 regression Playwright: **15 scenarios passed in development and
  production**, including actual signal checks for normal music, pauses,
  volume, navigation, standby players and reconnects.
- Mobile and desktop operation/production screenshots were inspected.

Generation-button regression checks additionally passed 15 production-service
tests and 13 E2E scenarios in both modes, including API-key-only configuration,
closing/reopening/reloading the panel, single voice generation and visible
failure/cached-retry feedback. Evidence: development
`/tmp/karaoke-phase2-e2e-h3rEDy`, production `/tmp/karaoke-phase2-e2e-JvSZPO`.

Temporary evidence directories on the implementation machine:

| Run | Evidence |
| --- | --- |
| Phase 2 production | `/tmp/karaoke-phase2-e2e-Akm4eH` |
| Phase 2 development | `/tmp/karaoke-phase2-e2e-e7RZF0` |
| Phase 1 production regression | `/tmp/karaoke-animation-e2e-Myk55K` |
| Phase 1 development regression | `/tmp/karaoke-animation-e2e-8BA5zN` |

An earlier production regression run experienced transport disconnects and a
two-hour gap in the machine's timeline. Its pending request was correctly
cancelled and audio required unlocking after reconnect. The uninterrupted
repeat passed; that interrupted run is not counted as successful evidence.

### Administration redesign verification

The A/B/C redesign was checked in both development (React StrictMode) and the
production build with an isolated database and simulated ElevenLabs provider:

| Harness | Development | Production |
| --- | --- | --- |
| `npm run test:animation:e2e` | 16 passed | 16 passed |
| `npm run test:animation:phase2` | 13 passed | 13 passed |
| `npm run test:tables:e2e` | 18 passed | 18 passed |

These runs had no browser page errors. They include admin deep links and legacy
redirects (including sign-in return destinations), keyboard menu navigation/Escape/focus, participant permission checks,
mobile table actions, continued generation across navigation/reload, preserved
session identity, and unchanged playing media element/time while navigating
administration. Screenshots at mobile and desktop sizes were inspected; the
header's border-box measurement prevents mobile menu padding from covering titles.
The animator was exercised at 320, 390, 768 and 1440 px.

TypeScript checking, scoped ESLint, `git diff --check`, server/client builds and
all five `server/lib/clientAssets.test.ts` tests passed. The full unit suite was
not rerun for this reorganization; the earlier phase 2 baseline above
is historical. Build output retains dependency-license and bundle-size warnings.

| Run | Temporary evidence directory |
| --- | --- |
| Animation development / production | `/tmp/karaoke-animation-e2e-bC7HK7` / `/tmp/karaoke-animation-e2e-IpYs9B` |
| Production workflow development / production | `/tmp/karaoke-phase2-e2e-nHcZml` / `/tmp/karaoke-phase2-e2e-cIgmos` |
| Administration/tables development / production | `/tmp/karaoke-table-e2e-YLilxh` / `/tmp/karaoke-table-e2e-EKqN8r` |

Use `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium` with each harness on the
verification machine. Add `KARAOKE_E2E_MODE=development` for development runs.
The provider fixture handled 21 simulated generation requests per phase 2 run;
no account credits were used. Live-provider quality and venue output remain
outside these automated checks.

The redesign rollback boundary is the new `src/components/Admin/` shell plus
its routing/header/account/queue/library integration, animator presentation,
SPA route whitelist and corresponding harness/documentation changes. It adds
no schema or scheduling migration; preserve the earlier phase 2 backend work
when reverting this UI work unit.

**Acceptance remains conditional on a small real-account generation test and
physical listening/monitoring validation.** Those checks require the configured
account/voice and venue equipment; they are not established by simulated API
responses. The production UI, rather than an automatic startup action, creates
the real pilot catalog under the administrator's configured limits.

## Recovery and rollback

Switch back to **Manual** to pause automatic opportunities, or disable the animator
to stop its audio. Music ordering and controls remain available. Keep generation
and playback history; do not delete tables to reset a budget or uncertain result.
Before reverting application/schema versions, stop the server and restore a
matching database backup. Published local assets remain reusable without the
provider. Phase 3 starts only after the user accepts this phase's delivery.
