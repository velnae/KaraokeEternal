# Automatic karaoke calls — batch 3 implementation plan

**Status: 3A–3C implemented. The automated 3D rehearsal is implemented and has
passed in production and development/HTTPS. Venue listening and user acceptance
of the new automatic workflow remain separate.**

## Delivered workflow — 2026-11-06

1. In **Proveedores de audio → Saludos de participantes**, review shared generation
   enablement and request limits. Set the independent sound defaults in
   **Llamados y plantillas**. Explicit private previews remain usable.
2. In **Animador → Llamados**, choose automatic introduction rotation or one saved
   variant. **Generar N audios de plantillas** explicitly prepares the listed missing
   fixed sources without enabling public speech. The server validates the quoted
   task list, captures its profiles and processes it through the bounded worker.
3. Enable **Llamados automáticos** once for the room. It also starts any missing
   setup work. Keep the animator's automatic mode/presentations enabled in Control;
   a deliberately closed jornada needs a new jornada before calls resume.
4. Approved singing requests now prepare from their existing table/name/title with
   the administration page closed. Their status and private listening appear under
   **Pedidos de karaoke**. No Generate/Approve/Announce action is needed per request.
5. The player uses a ready personalized call, a prepared table fallback, a neutral
   fallback, or the visual presentation if no voice is playable. Listening and
   house music retain the general animator. Pause/skip and existing room controls
   retain authority.

## Current fixed-bank and credit policy

This policy supersedes automatic bank rebuilding described in the original plan.
Existing selected recordings retain their files, checksums and source profile.
Changing model, voice or style defaults, opening administration or restarting the
server never authorizes a new fixed-bank synthesis. Changed table codes/text remain
blocking, so an outdated number cannot be announced as a different table.

The manual bank action quotes a closed list, including missing table voices,
introductions, sender prefix and basic fallback phrases. A changed list is rejected
before generation. Duplicate submissions reuse the receipt. Paused batches resume
only explicitly, retaining their original list and profiles; enabling automatic
calls does not resume a paused paid batch. Local composition cannot synthesize a
missing fixed source. Names and request-specific singing continuations retain their
existing request-driven generation and shared budget. Singing continuations require
**Llamados automáticos** to be enabled; preparing the fixed bank alone does not
authorize request-specific singing speech.

Migration `049-persistent-call-bank.sql` adds nullable source-profile metadata and
the bank manifest to existing tables. Startup backfills only known exact profile
identities and cancels old unsent automatic bank receipts; it never regenerates
audio or repeats uncertain requests. Pausing cannot undo a request already sent
to the provider.

Migration `027-automatic-karaoke-calls.sql` adds controls, request/fallback bindings
and intervention call context. Existing installations start with calls disabled.
Databases that received an early revision of 027 are repaired by conditional
migrations 030/031, which add the missing setup receipt/attempt fields without
replacing table voices. Four migration cases cover missing, partial and current
schemas, including idempotent setup after upgrade.
Source pieces stay outside the public catalog. Automatic admission reserves one
of the ten worker slots for explicit private work; pending requests remain durable
outside that admission window. Pausing preparation preserves queued work and valid
in-flight results for reuse after re-enabling.

`Calls/Playback.ts` supplies request-bound assets to the existing greeting/transition
reservation path, including call-only deliveries without a greeting record. One
reservation covers a call and a fitting greeting. A long/unready greeting remains
visual and reads concurrently with the call. Confirmed starts are recorded once;
a proven pre-start cancellation can retry with a fresh intervention identity.

The same scene, two-second lead-in and independent ambience gain remain in use.
Playback never waits for Gemini. Profile/name/table changes invalidate stale audio;
unchanged requests reuse it. Composition cache identity includes the piece text and
profile as well as its bytes, preventing a cached file's metadata from describing
a different call. Request/lease references protect audio from preview cleanup.

### Verification commands

```sh
npm test -- server/Animation/Calls server/Greetings/transition.test.ts server/Greetings/socket.test.ts server/Greetings/Greetings.test.ts server/Greetings/GreetingVoice.test.ts server/Greetings/AudioJobs.test.ts server/Animation/Animation.test.ts src/routes/Player/components/Animation/AnnouncementAudio.test.ts
npm run typecheck
TMPDIR=/tmp/opencode KARAOKE_E2E_MODE=production PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:animation:calls:playback
TMPDIR=/tmp/opencode KARAOKE_E2E_MODE=development KARAOKE_E2E_HTTPS_UI=1 PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:animation:calls:playback
```

The automatic playback harness extends the private pilot with real QR admission,
singing/listening/house requests, server-side preparation with Llamados closed,
one call plus a greeting, simulated Gemini failure, prepared fallback, pause during
the intro, resume and persistence. Audio-source traces check that voices do not
overlap and that calls follow the intro. Setup tests cover fourteen tables and
request retention beyond the ten-preview limit. Existing greeting regressions also
cover remote latency, long voice, withdrawal and restart.

All generated verification audio uses an isolated provider fixture. The HTTPS run
loads the actual tunnel frontend but routes API/socket traffic to temporary data;
it does not activate calls or generate speech in the shared room. Desktop/mobile
screenshots and keyboard controls are included. Actual new-bank pronunciation and
venue loudness still need the operator's listening check.

### Delivery evidence

| Check | Result |
| --- | --- |
| Calls, animation, greetings, audio channel, rooms and tables | 189 focused tests passed. |
| Transition presentation and canonical queue selection | 35 tests passed, including the nine presentation combinations. |
| Changed-file ESLint, TypeScript and whitespace | Passed. |
| Server/client production builds | Passed; existing dependency-license and bundle-size warnings remain. |
| Automatic-call production E2E | Passed, including preparation after navigating the administration page to `about:blank`. |
| Automatic-call development StrictMode + HTTPS E2E | Passed against the actual HTTPS frontend with isolated API/socket traffic. |
| Existing greeting playback E2E | Passed in development and production, including long greetings, latency, withdrawal and restart. |
| Visual/keyboard checks | Desktop 1440 and mobile 390 screenshots reviewed; setup and activation exercised by keyboard. |
| Shared HTTPS read-only smoke | Page 200, HTML `no-store`, anonymous call-management access 403. |

Final automatic-call artifacts: `/tmp/opencode/karaoke-call-pilot-tS2BmX`
(production) and `/tmp/opencode/karaoke-call-pilot-4ViVJs` (development/HTTPS).
Greeting artifacts: `/tmp/opencode/g-audio-e2e-BNHH3O` (development) and
`/tmp/opencode/g-audio-e2e-aN2gNL` (production). The automatic-call artifacts include
audio-source traces and screenshots. The Chrome MCP timed out; verification used
the installed Playwright/Chromium runner.

The remaining sections retain the implementation contract and review path.

### Real bank preparation — 2026-11-06

The authorized Gemini preparation for room 1 completed: twelve new table voices
(02–13), fourteen composed table fallbacks and one general fallback. Existing voices
01/14 and both introduction variants were reused unchanged with the configured Puck
profile. All 31 operational assets were fetched over HTTPS and checked for SHA-256,
MP3 format and measured duration; fallback duration is 3.214–6.453 seconds.

A confirmed provider rate rejection for table 11 was retried once after the cooldown;
the final bank has no failed or pending resources. Public calls remain disabled.
This verifies real files, not acoustic approval. The ignored local execution receipt
is `.atl/audio-batches/gemini-call-bank-2026-11-06.json`, including job IDs and the
recovered attempt.

Connect the accepted hybrid pilot to real queue requests and the authoritative
player. After room setup, calls prepare and play without per-request operator
actions or an open administration page. Reuse the existing video, two-second
ambience lead-in, prepared audio channel and musical ordering.

Batch 2 was accepted by the user on 2026-11-06. That acceptance closes the private
pilot; it does not claim that automatic preparation or public playback exists.
This plan details the [revised batch 3 scope](TRANSITION-ANNOUNCEMENTS-PLAN.md#batch-3--automatic-hybrid-calls-from-real-requests)
and absorbs the essential request integration previously assigned to batches 4–5.

## Operating decisions

These defaults are implemented by the delivery above.

| Topic | Proposed decision |
| --- | --- |
| Eligible requests | Open room, enabled calls, `APPROVED`, explicit `SING`, and origin other than `HOUSE`. `LISTEN`, `UNKNOWN` and house tracks retain their current animator path. |
| Performer | Use the existing request's `userDisplayName`, also shown by the player. A separate performer/group field is a later refinement, not a new mandatory form. |
| Table | Bind by `roomId` and `tableId`; preserve consistency with the request's table snapshot. Never recover identity by parsing a label or choosing another table. |
| Spoken content | Existing introduction + saved table phrase + `callContinuation(performer, song)`. Do not read a YouTube channel as an artist. |
| Missing/long text | Use a deterministic, versioned plain-text policy. Keep full information on screen; use the basic call if a reliable personalized script cannot fit the limits. |
| Introduction | Select automatically from enabled, compatible variants, balancing request assignments. Freeze the selection for the request version. Reordering alone does not choose again. |
| Preparation | Register work when a request becomes eligible; reconcile after restart or missed notifications. Prioritize actual upcoming requests without changing song order. |
| Generation | Reuse the accepted Gemini profile, shared quota gate and existing worker. Automatic work respects generation enablement and never uses the private-preview bypass. |
| Playback | One prepared MP3, at most 10 seconds of call voice, reserved only when its current checksum is ready in the player. No provider request at the song boundary. |
| Fallback | Personalized call → prepared basic table call → prepared neutral karaoke call → visual identification and music if no voice is playable. |
| Screen | Keep batch 1's incoming card and `Después`. Do not restore the animator transcript. |
| Ordinary operation | No per-request Generate/Approve/Announce action. Operator actions are setup, pause/disable, explicit edits and recovery from configuration/uncertain-provider errors. |

The initial bank covers active tables 01–14. Existing custom spoken text is
preserved; unsupported/custom identities require an explicit usable text rather
than an invented pronunciation. A table's optional display-name change alone
should not regenerate its unchanged spoken code.

## Verified reuse and necessary adaptations

| Current code | Adaptation for this batch |
| --- | --- |
| `shared/types.ts`, `server/Queue/Queue.ts` | Queue items already contain `tableId`, `tableLabelSnapshot`, `requestIntent`, `title` and `userDisplayName`. The name is joined from `users`, so a later name edit can change a pending request's presentation. |
| `server/Animation/Calls/Jobs.ts` | Keep receipts, composition and reuse. Add automatic/setup purposes; current `generatePart` always passes `preview=true`. The ten-active-job limit needs admission handling, not a loop of rejected submissions. |
| `server/Animation/Calls/Store.ts` | Extend version checks with queue-bound input identity and room-control revision. Existing checks already cover selected table part, table code and introduction replacement. |
| `CallJobs.cleanup()` | Preserve request-owned results, fallback assets and active playback leases before applying the ten-preview retention policy. |
| `server/Greetings/GreetingVoice.ts` | Keep the singleton, one in-flight provider call, accounting and retry timing. Separate private-preview permission from automatic generation. |
| `AnnouncementAudio.ts` | Normal preload fetches catalog assets only. Add bounded ownership for call assets; catalog/greeting refreshes must not evict a pending or playing call. Retain the shared 64 MiB decoded-audio budget. |
| `Animation.ts`, `socket.ts`, `usage.ts` | Reuse player ownership, epoch, context checks, reservations, start/end acknowledgments and confirmed usage. Do not add a second playback authority. |
| `PlayerController.tsx`, `useGreetingPlayer.ts` | The current greeting-first branch can consume the entire boundary. Integrate one call/greeting plan before the generic animator branch. |

## Architecture and persistence

```text
Eligible approved request
    → server reconciliation and bounded admission
    → existing Calls worker and Gemini gate
    → immutable prepared result bound to the request version
    → player preload and readiness
    → existing authorized transition reservation
    → confirmed playback or prepared fallback
```

Extend the feature-owned `server/Animation/Calls/` module. Suggested additions are
`Automation.ts` for reconciliation/admission and `Playback.ts` for prepared assets
and transition integration. Extend `Store.ts`, `Jobs.ts` and `router.ts` instead of
building another provider client or catalog.

Use a forward migration after the latest schema at implementation time. Suggested
records and fields are contracts; final names should follow the existing module.

| Record | Responsibility |
| --- | --- |
| `karaokeCallControls` | Versioned preparation/public enablement, selected introduction variants and setup progress. Default automatic operation to off for existing installations. |
| `karaokeCallRequests` | Unique room/queue binding, input version/key and text snapshot, selected intro/table parts, profile/recipe version, job/result references, preparation state, fallback reason and delivery reference. |
| Fallback bindings | Current neutral room call and per-table basic calls, including their dependencies/profile. These may be stored alongside controls/table bindings; avoid a general-purpose new resource framework. |
| Existing jobs | Distinguish explicit preview/setup from automatic request work; store enough purpose/identity to apply the correct permission, retry and retention rules after restart. |

Preparation state and public delivery state are separate. A ready preview is not
a publicly announced request. Keep public start/finish receipts with the existing
intervention, and link them to the request binding.

Preparing requests during 3B must not implicitly enable public playback when 3C is
deployed. Require one initial room-level activation for live calls; this is not a
per-request approval. The final operator flow remains one automatic-call control
plus explicit private setup/preview tools.

### Identity and invalidation

- A request input key covers room/queue identity, spoken/displayed person and table,
  spoken title, selected source versions, Gemini profile and recipe revision.
  The underlying audio cache still reuses identical compatible text/pieces across
  requests; do not add queue identity to every provider-cache key.
- Capture the spoken table identity consistently with the queue snapshot. For a
  legacy/renamed request whose snapshot cannot be matched reliably, use the neutral
  fallback rather than silently updating its label or speaking the new number.
- Name/text/profile/part changes invalidate affected preparation. Queue reordering
  changes priority and delivery eligibility, not unchanged audio identity.
- Rejection, removal or completed playback retires the request's preparation need.
  Check eligibility again before provider work, publication and playback. Discard
  late results for obsolete inputs; retain valid shared source pieces.
- Do not alter QR tokens, participant sessions or unrelated queue scheduling data.

### Retention

Pin current setup/fallback assets, queued request dependencies, ready results and
active/reserved delivery assets. Traverse composition dependencies before cleanup.
Release a request's pins only after it leaves the pending queue and any playback
lease has ended. Preserve receipts/accounting even when audio is retired.

The ten-result limit remains a private-preview policy. It must not discard the
eleventh customer's prepared call or a file being streamed to the player.

## Automatic preparation

1. Room setup reuses accepted introductions and existing table voices. Queue only
   missing or incompatible dependencies and basic fallback compositions. One setup
   operation resumes progress across reloads; do not submit fourteen jobs at once
   into the existing ten-active-job limit.
2. Server reconciliation creates an idempotent desired-work binding for each
   eligible approved request. Queue mutations wake it promptly; startup and a
   bounded server-side reconciliation pass cover missed events. UI polling is
   never the engine that starts generation.
3. Admit desired work as capacity becomes available. Use the current authoritative
   queue projection for upcoming priority, or stable accepted order while no player
   is present. Do not duplicate or mutate round-robin/house-insertion scheduling.
4. Prepare a whole continuation through the existing deterministic template and
   compose it with the selected intro/table masters. Reuse compatible continuation
   and composition outputs. Measure the complete result and reject over-limit audio;
   never truncate words, accelerate playback or start an unbounded regeneration loop.
5. Recheck versions and publish a ready request result atomically. Preload reads are
   side-effect-free and do not call Gemini. Pending musical requests remain valid
   regardless of speech preparation status.

### Enablement and failures

- Automatic generation requires room-call enablement, the shared Gemini generation
  switch and an open room. Do not pass `preview=true` to bypass a disabled global
  gate. Explicit private setup/preview retains its existing intentional permission.
- Live speech additionally respects existing animator/automation controls, volume,
  player authority and browser audio readiness. Do not silently enable greetings
  or change the Gemini profile when enabling calls.
- Capacity and safe pre-dispatch busy/rate responses are deferred using existing
  retry timing. Authentication errors, definitive failures and ambiguous provider
  results expose a concise status and use prepared fallback; do not blindly resubmit
  uncertain generation after a restart. Only exceptional recovery needs an operator.
- Disabling calls stops new automatic admission and invalidates unstarted delivery
  grants. Preserve reusable prepared audio and leave private listening available.

## Player integration and greeting coordination

### Preload and authorize

Expose a request-bound preparation DTO with result/fallback IDs, checksums,
durations, compatible input key and base-path-aware asset URLs. Verify room scope
and queue association before serving metadata or bytes. A historical arbitrary
preview ID must not authorize a public call.

Add a small call-preparation group to `AnnouncementAudio`, protected during both
catalog and greeting refreshes. Prioritize the immediate request and its fallbacks;
keep the window bounded rather than decoding the whole queue. Include these
checksums in readiness reporting without dropping them behind catalog entries.
Respect the shared memory limit and release unused buffers on room/queue changes.

At the boundary, re-read the actual immediate request, not `Después`. Reserve only
a current, ready call through the existing room/epoch/intervention fence. Extend
the normal start validation with the request input key and call-control revision.
Make the reservation after the two-second lead-in, not before a short start lease
would expire. No network synthesis is awaited at this point.

### One transition, one presentation

Proposed default when the singing request also has a greeting:

1. The karaoke call replaces the generic announcement and the generic greeting intro.
2. Show the greeting in the existing compact layout; play its voice after the call
   only if both fit the shared voice budget and delivery window.
3. Otherwise preserve the greeting visually, with its reading-time contract, while
   reserving priority for the call. Visual reading can overlap call playback; do not
   append another full reading interval or restart the scene.

Account for startup/fade margins and elapsed intro time within a maximum 25-second
combined delivery plan. Keep each call at most 10 seconds; do not stretch the window
to fit two independently reserved voices. If no call audio is usable, the greeting
can retain its existing eligible delivery while the track information stays visible.

Honor operator pause/skip and an already-authorized manual intervention; do not
interrupt it with a second voice. General animator speech remains the ordinary
path for listening/house tracks. Shared voice limits still apply; a repeated valid
karaoke request is identified by its request/delivery receipt rather than filtered
out merely because its spoken words match another request.

### Confirm and recover

Record public usage only on confirmed starts. Use an explicit call-asset identity
with the existing usage ledger, outside `audioResources`. Preview never counts.
Prevent duplicate confirmed starts for the same request delivery. A cancelled
pre-start attempt may be reserved again if the request is still eligible; pause,
reconnect or replay must not resurrect already-started speech.

Revalidate before starting music and after asynchronous steps. Queue changes,
provider completion or reconnect cannot reopen a cancelled transition. If every
voice fallback is unavailable, show the correct track information and continue
music through the existing recovery path.

## Minimal operator/API surface

Extend **Animador → Llamados**, preserving its existing private pilot tools:

- Room-level automatic-call control and a single resumable setup operation.
- Readiness such as `Mesas preparadas: 12 de 14`; missing/configuration states show
  a next action. Do not add a confirmation step for each musical request.
- Compact request status: preparing, ready or using fallback, with private listening
  and an exceptional retry action. Normal requests require no operator attention.

Suggested extensions under the existing room-scoped router:

| Operation | Contract |
| --- | --- |
| `GET /karaoke-calls` | Extend the existing snapshot with controls, setup and bounded request status. |
| `PUT /karaoke-calls/automation` | `revision`, `preparing`, `enabled` and `introIds` (compatible variant identities). |
| `POST /karaoke-calls/setup` | `requestId` and expected `revision`; enqueue missing sources/fallbacks within worker capacity. |
| `GET /karaoke-calls/requests/:queueId` | Current status and preparation metadata; no generation side effect. |
| `GET /karaoke-calls/requests/:queueId/audio/:id` | Serve only an associated ready asset or active-lease asset, with room authorization. |
| `POST /karaoke-calls/requests/:queueId/retry` | Exceptional explicit retry for the expected input version, not an automatic uncertain-result loop. |

Public playback uses the existing authorized socket reservation/event flow, extended
with server-derived call context. Do not add an unrestricted HTTP "play this ID"
endpoint or take client-supplied singer/table text as reservation authority.

## Reviewable implementation increments

### 3A — Room setup and reusable fallback bank (delivered)

**Deliver:** versioned controls, resumable bulk setup, compatible intro/table reuse,
basic table/neutral fallbacks and visible setup progress in Llamados. Private
listening works; public-call integration remains pending 3C.

**Main files:** `shared/karaokeCalls.ts`, `Calls/{Store,Jobs,router}.ts`, a forward
migration, `GreetingVoice.ts`, `KaraokeCallPilot.tsx` and `useCallPilot.ts`.

**Accept:** repeated setup does not duplicate work; fourteen tables progress despite
the worker cap; missing/disabled Gemini has visible guidance; existing private
preview still works. Test permission modes, restart, identity changes and fallback
duration. Include real listening of the generated fallback bank.

### 3B — Queue-driven personalized preparation (delivered)

**Deliver:** request bindings, server reconciliation, bounded priority admission,
retention pins and automatic generation from real request data. Operators can see
and privately hear prepared requests without filling the pilot form.

**Main files:** proposed `Calls/Automation.ts`, extended `Calls/{Store,Jobs,router}.ts`,
queue mutation integration, `serverWorker.ts`, shared DTOs and compact request status UI.

**Accept:** approved singing requests prepare with administration closed; pending
approval, listening and house requests do not. Reordering reuses audio; meaningful
edits invalidate it. Test more than ten requests, missing parts, cancellation,
profile changes, provider failures, restart and prevention of cross-room reuse.
Automatic jobs must not inherit private-preview enablement.

### 3C — Automatic public delivery with greetings and fallback (delivered)

**Deliver:** bounded call preload, request-bound reservations, confirmed usage,
greeting coexistence and the fallback chain in the existing continuous transition.

**Main files:** proposed `Calls/Playback.ts`, `Animation.ts`, `socket.ts`, shared
animation/call contracts, `AnnouncementAudio.ts`, `useAnimationPlayer.ts`,
`useGreetingPlayer.ts`, `PlayerController.tsx` and greeting transition integration.

**Accept:** successive singing requests announce their own table/person/song once;
general speech still runs for listening/house music. Verify queue changes between
preload/reservation/start, repeated commands, disabled controls, slow generation,
memory pressure, removed files and active assets surviving cleanup. Greeting
content is preserved without competing reservations or a second intro.

### 3D — Autonomy rehearsal and handoff (technical rehearsal complete)

**Deliver:** an integrated operation walkthrough and targeted fixes found on the
venue's real setup. Record evidence and actual remaining limitations.

**Accept:** after initial setup, a mixed queue runs unattended through all nine
incoming/following type combinations, all fourteen tables, greeting cases and
fallbacks. Verify sound intelligibility, independent ambience level and consistent
screen/voice information. Each earlier increment already includes its own tests;
3D does not defer regression coverage until the end.

## Verification and rollout

| Boundary | Required regression evidence |
| --- | --- |
| Generation permission | Private explicit preview can still run as designed; automatic work obeys global/room switches and shared quota/concurrency. |
| Binding and caching | Correct room/table/request, changed names/code/profile, intro replacement, identical-input reuse and no regeneration from order alone. |
| Capacity and storage | Fourteen-table setup, more than ten queued requests, retained dependencies, pending downloads/leases and restart cleanup. |
| Playback identity | Actual immediate request, authoritative owner/epoch, stale snapshot rejection, pre-start retry versus duplicate confirmed start. |
| Timing and coexistence | Two-second intro, continuous video/ambience, complete voice limits, greetings, manual controls, no provider wait at the boundary. |
| Failure paths | Missing/stale assets, unavailable Gemini, safe retry timing, uncertain outcomes, disabled controls and visual-only last resort. |

Use focused tests alongside each changed behavior, changed-file ESLint and
`npm run typecheck`. Extend `config/karaoke-call-pilot.e2e.mjs` for setup/preparation
and add an isolated automatic-call scenario for real queue/public-delivery behavior.
The delivered harness is `config/karaoke-calls-playback.e2e.mjs`, with scenarios in
`config/karaoke-call-playback-checks.e2e.mjs` and script `test:animation:calls:playback`.

Existing regression entry points include `npm run test:animation:calls`,
`npm run test:transitions:player`, `npm run test:greetings:playback` and
`npm run test:greetings:audio` for shared Gemini changes. Run affected audio paths
in development StrictMode and production, building only required changed targets.
Exercise the actual HTTPS frontend with isolated API/socket fixtures for destructive
cases, and record the relevant shared-HTTPS smoke check separately. UI changes
require desktop/mobile screenshots and keyboard validation.

Implementation verification uses simulated provider responses and temporary data.
Record authorized real-voice listening separately; do not report simulated audio
as pronunciation acceptance. Approval of this document is not a provider call.

Disabling automatic calls restores the existing animator route while preserving
the private pilot, batch 1 presentation and reusable files. Each increment records
its tests, demonstration, user acceptance and rollback boundary in this document.

## Next action

Review the implemented workflow and listen to the new bank in the venue before
enabling automatic calls for an operating session. Record that acceptance separately
from the isolated technical checks above; the software does not require approvals
for individual musical requests.
