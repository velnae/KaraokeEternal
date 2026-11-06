# Hybrid karaoke calls — private batch 2 pilot

**Status: private pilot 2A–2D implemented and technically verified. Real-voice
listening and user acoustic acceptance remain pending.**

Deliver a private, usable pilot of three-part calls: reusable introduction,
table-bound recording and a Gemini-generated performer/song continuation. The
server prepares one final audio file; the browser only downloads and plays it.
This refines [batch 2 of the transition plan](TRANSITION-ANNOUNCEMENTS-PLAN.md#batch-2--hybrid-audio-pilot).

## Delivery — 2026-11-06

The administrative workflow, persistence and A/B tools are implemented. Automated
checks use an isolated Gemini fixture producing real WAV bytes; they prove the
integration and playback, not the pronunciation or naturalness of a real model.
No paid synthesis or public-room announcement was triggered during verification.

### Operator quick path

1. Open **Ajustes → Animador → Llamados**. Review the shared Gemini profile, enter
   an introduction and choose **Generar introducción**.
2. Open **Salas y mesas → Ver mesas → Voz de la mesa**. Review its spoken text and
   choose **Generar voz**. A later edit/profile change exposes an outdated state.
3. Return to **Llamados → Probar llamado**. Select the introduction and table,
   enter performer/song, then choose **Preparar prueba** in hybrid mode.
4. Repeat with **Referencia: frase completa con Gemini**. Compare results through
   **Escuchar** in **Preparaciones recientes**. Closing the listener or leaving
   the page stops local playback.
5. Approve the actual voice and joins before expanding the bank or activating live
   transitions. The rest of the six-batch rollout remains separate.

Implemented files include migration `026-karaoke-call-pilot.sql`, the private
`server/Animation/Calls` module, `shared/karaokeCalls.ts`, the Llamados panel and
the table voice modal. Parts retain canonical, edge-trimmed/faded and normalized
WAV masters. A final composite is validated and exported as a single MP3; overlong
results fail with a shortening instruction instead of truncating speech.

The existing Gemini singleton remains the quota/concurrency authority. Call-role
directions are applied only after validating the saved base profile. Generation
does not require a greeting record or enable automatic greeting/public playback.

Request receipts, compatible-part reuse, explicit regeneration, cancellation and
uncertain restart outcomes are covered. The selected table part ID is checked as
well as its binding revision: finishing a replacement cannot silently validate a
composition that captured the old piece. Retention keeps current sources and ten
completed preview results per room; abandoned scratch/orphan files are cleaned.
Status polling waits for each response before scheduling another request, so a
slow tunnel cannot continuously invalidate responses and leave the controls loading.

### Verification evidence

| Check | Result |
| --- | --- |
| New Calls module | 14 focused tests passed, including composition duration, privacy, reuse, replacement races and retention. |
| Related greeting/table regressions | 99 existing/extended checks passed in the broader scoped run; no greeting playback contract was changed. |
| TypeScript and changed-file ESLint | Passed. |
| Server/client production builds | Passed; existing dependency-license and bundle-size warnings remain. |
| Pilot production E2E | Passed; three table cases, hybrid/reference output, delayed status responses, keyboard, reload, cancellation, restart and no public usage. |
| Pilot development StrictMode + HTTPS frontend | Passed with isolated API/socket traffic; no test fixtures were written to shared room data. |
| Existing greeting-audio E2E | Passed in development and production. |
| Visual review | Desktop 1440 and mobile 390 screenshots reviewed, including the table modal; no document overflow. |
| Shared tunnel smoke | Real HTTPS page returned 200/no-store and anonymous private-call endpoint returned 403. Authenticated pilot mutations were verified against the isolated API. |

Final pilot artifacts: `/tmp/opencode/karaoke-call-pilot-vvuAEL` (production) and
`/tmp/opencode/karaoke-call-pilot-NTeJIr` (HTTPS frontend/development). Greeting
regressions: `/tmp/opencode/g-audio-e2e-WmDa6R` (production) and
`/tmp/opencode/g-audio-e2e-qBETWg` (development).

Run the isolated pilot with:

```sh
TMPDIR=/tmp/opencode KARAOKE_E2E_MODE=production npm run test:animation:calls
TMPDIR=/tmp/opencode KARAOKE_E2E_MODE=development KARAOKE_E2E_HTTPS_UI=1 npm run test:animation:calls
```

The following sections retain the implementation design and its later-batch boundaries.

## Proposed contract

| Piece | Example | Ownership and generation |
| --- | --- | --- |
| Introduction | `¡Vamos con el karaoke!` | Reusable room variant, managed under Animador → Llamados. Generate once per text/profile revision. |
| Table | `Desde la mesa siete,` | Recording bound to the actual room/table ID, managed in Salas y mesas. Generate once per spoken-text/profile revision. |
| Continuation | `recibamos a Ana con Rayando el sol. ¡Un aplauso!` | Generated for the private pilot input; future batches derive it from the musical request. |
| Final call | All three pieces in that order | Immutable composed MP3 with the exact input versions and measured duration. |

All three pieces use the same Gemini base profile: model, voice and base style.
Speech directions stay in structured metadata, not in the spoken text. The pilot
does not silently substitute the existing ElevenLabs animator voice for Gemini.
The measured **complete call must fit the current 10-second voice limit**.

Batch 2 ends with private listening and acceptance. Automatic preparation from
approved queue requests and public playback remain later increments. Existing
video, ambience, general announcements, greetings and room controls continue to
operate independently of the pilot.

## Verified integration points

| Existing implementation | Reuse or required adaptation |
| --- | --- |
| `server/Tables/Tables.ts` and `router.ts` | Stable room/table identity and administrative routes already exist. Voice binding must not modify QR tokens or participant sessions. |
| `src/routes/Account/components/Rooms/Tables/Tables.tsx` | Extend the current table manager with a small voice editor rather than a second table-management screen. |
| `server/Greetings/GeminiGreetingTts.ts` | Reuse the existing REST adapter, complete WAV response and separate text/style fields. |
| `server/Greetings/GreetingVoice.ts` | Reuse the application-wide generation gate, credentials, quota accounting and concurrency limit. Do not instantiate a separate quota bypass for calls. |
| `server/Greetings/AudioJobs.ts` | Reuse job-lifecycle patterns, not greeting-specific eligibility queries. Its current preview uses a fixed sample and deletes the result, so it is not a persistent call store. |
| `server/Animation/AudioPreparation.ts` | Reuse final validation, loudness normalization, MP3 export and checksum. It removes its raw temporary input, so composition masters must be preserved separately. |
| `server/Animation/catalog.ts` | Ready catalog voices can become available for announcements. Internal pieces and private compositions must stay outside this public catalog. |
| `src/components/Admin/AnimatorSettings.tsx` | Add a room-scoped `Llamados` view alongside existing animator settings. Follow the private-preview interaction used by `GreetingVoiceSettings.tsx`. |

The current shared Gemini gate compares the requested profile with the saved
profile. If different directions are needed for an introduction versus an open
table phrase, add a **server-defined speech-purpose parameter**. Validate the
unchanged base profile first, then derive the effective role style. Include that
effective style and its revision in audio identity. Existing greeting calls keep
their current default behavior; clients cannot bypass the profile check.

## Implementation structure

### Internal resources and persistence

Add a small feature-owned module at `server/Animation/Calls/`, with contracts in
`shared/karaokeCalls.ts`. Use the existing SQLite connection and forward migrations;
choose migration numbers at implementation time after the currently latest schema.

Proposed records, separate from public `audioResources`:

| Record | Responsibility |
| --- | --- |
| `karaokeCallParts` | Versioned introduction/table/continuation pieces: room, role, text, base/effective profile, WAV master, preview MP3, duration, checksums and retirement state. Introduction variants also carry a stable variant identity. |
| `tableCallVoices` | One current binding per room/table: desired spoken text, code snapshot, revision and selected ready part. Audio bytes remain on disk. |
| `karaokeCallJobs` | Generation/composition receipts, operation, request ID, input snapshot, dependency versions, state/error and prepared result metadata. |

Keep masters and derivatives beneath the configured data directory, for example
`KES_PATH_DATA/animation/calls`, with staging and generated filenames. Do not insert
these resources into the ordinary catalog or expose filesystem paths in responses.
Room-scoped routes may serve a ready preview, but no pilot operation creates an
`animationInterventions` entry or a public `audioUsage` event.

Maintain the existing state vocabulary: queued, generating, preparing, ready,
failed, uncertain and cancelled. Derive `Desactualizado` from input/profile changes
rather than treating an old ready file as suitable for a new table label.

### Identity, changes and reuse

- Deduplicate transport retries by room/request ID and input identity. Repeated
  requests with different payloads under the same ID must be rejected.
- Part identity includes room, role, literal text, model, voice, effective style
  and processing revision. Explicit regeneration creates a new version.
- Composition identity includes the three part checksums and the composition
  recipe revision. Changing only the introduction can reuse a compatible continuation.
- Publish a table replacement only if its expected binding revision and table code
  still match. Renaming a code during generation cannot attach an obsolete result.
- The default numeric phrase uses the code, not the table's optional display name:
  `07` becomes `Desde la mesa siete,`. Custom codes need an explicit spoken text.
  Only changes to the pronounced identity require new audio.
- Preserve older referenced versions. Disable/archive prevents selecting that table
  for a new pilot, without changing the existing session/QR rules.
- Keep current bound parts and at most ten completed pilot results per room.
  Remove abandoned staging and unreferenced files; never delete active job inputs.
  File cleanup must not erase provider quota receipts.

### Generation and composition

1. Validate the selected room/table, current introduction and common base profile.
   Freeze the performer, title, literal scripts and dependency versions for this job.
2. Return an accepted job promptly. A bounded worker uses the existing Gemini gate;
   private generation is explicit even when automatic greeting generation is off.
3. Reuse ready compatible pieces. Generate only missing/explicitly regenerated
   pieces, retaining validated PCM/WAV masters and separate listening derivatives.
4. Generate the whole continuation in one request, not the name and title separately.
   Build its text from a deterministic template, with style passed separately.
5. Join the three masters in canonical PCM on the server. Remove only excess
   boundary silence using recorded, reviewable settings; preserve words and natural
   pauses. Use short edge fades without overlapping syllables. No browser composition.
6. Run the complete result through `prepareAudio` and measure its actual duration.
   If too long, explain which script needs shortening; do not cut words or speed up
   playback. Apply the existing spoken-text limit to the assembled transcript too.
7. Commit the ready output only after rechecking cancellation and input versions.
   Private playback consumes that one file and reuses it on subsequent listens.

Quota/busy responses follow the shared gate's retry timing. An ambiguous provider
result or interrupted in-flight generation must not be blindly resubmitted after
restart. Show a recoverable state; an explicit new generation remains possible.
Cancellation discards publication of late output, not the existing selected table
recording. Prefer serialized provider and FFmpeg work for this pilot.

## Operator experience

### Animador → Llamados

- **Introducciones:** name, spoken text, current Gemini profile, state and
  `Generar` / `Escuchar` / `Regenerar`. Support multiple saved variants; select one
  explicitly for the pilot rather than adding automatic rotation now.
- **Probar llamado:** introduction, active table, performer and song title.
  Display the assembled transcript before generation. Offer `Preparar prueba`,
  local listening and elapsed provider/preparation times.
- A ready result stays available after a page reload. Errors explain the next
  action. Empty introduction/table states link to the corresponding setup.
- Keep the current theme, Button/Panel/Modal conventions and private audio controls.
  Use clear headings and one primary action per section, not another dashboard.

### Salas y mesas → Voz de la mesa

Add a compact editor showing the spoken text, profile and readiness, with the same
generation/listening actions. Start with `Desde la mesa [number],` for numeric
codes. A changed phrase/code/profile shows `Desactualizado` and regeneration guidance.
Saving a table or opening its editor never triggers synthesis by itself.

Private generation consumes the same configured Gemini limits as greetings.
Display the effective shared profile and link to its settings; changing the voice
must not happen implicitly while editing a table. Closing a preview, switching
rooms or leaving the view stops local audio and releases its browser URL/resources.

### Proposed HTTP boundary

Use the current administrator authorization convention and validate every table,
part and job against the explicitly addressed room. Administrators can manage rooms
as they do today; a resource ID from another room cannot be attached to this one.

| Operation | Purpose |
| --- | --- |
| `GET /api/rooms/:roomId/karaoke-calls` | Introduction variants, compatible profile, readiness and recent pilot results. |
| `POST /api/rooms/:roomId/karaoke-calls/intros` | Explicit new/regenerated introduction job with request ID and expected version. |
| `GET /api/rooms/:roomId/tables/:tableId/voice` | Current table voice and validity. |
| `POST /api/rooms/:roomId/tables/:tableId/voice/generate` | Validate/save desired text and start one versioned generation job. |
| `POST /api/rooms/:roomId/karaoke-calls/previews` | Prepare a private composition from selected parts and performer/title. |
| `GET /api/rooms/:roomId/karaoke-calls/jobs/:id` | Progress, measured properties and actionable error. |
| `POST /api/rooms/:roomId/karaoke-calls/jobs/:id/cancel` | Cancel unfinished work without replacing a valid current part. |
| `GET /api/rooms/:roomId/karaoke-calls/audio/:id` | Authorized ready MP3 preview; private/no-store and base-path-aware URLs. |

Exact route names can follow surrounding conventions during implementation. The
room ownership, explicit-generation and private-preview boundaries are the contract.

## Reviewable implementation increments

| Increment | Working delivery | Acceptance and focused verification |
| --- | --- | --- |
| **2A — Introduction preview** | Internal store/jobs, shared Gemini integration and first usable Introducciones section. | Generate once, reload and listen privately; retry transport without duplicate synthesis; failure/restart remain visible. Verify migration, room scope and unchanged greeting behavior. |
| **2B — Table voice** | Generate and associate audio through the existing table manager. | Pilot tables 01/03/14 pronounce correctly; code/profile changes become stale; failed replacement preserves the previous file. QR tokens and unrelated table operations remain unchanged. |
| **2C — Complete hybrid call** | Performer/title continuation, server composition and private final preview. | One natural-sounding file, at most 10 seconds, correct three-part order, versioned reuse and cancellation. Delayed/failed generation never reaches the public player. |
| **2D — Listening acceptance** | A/B listening of three hybrid calls against the same three complete-phrase Gemini references. | User approves voice, joins, names/numbers, timing and consistency; record measured provider and preparation times separately. |

At 2D, the existing preview mechanism can offer a full-phrase reference mode using
the same base voice/style; it remains a private comparison, not another production
path. Use one introduction, three existing pilot tables and three fictitious
performer/title cases. Confirm the voice and exact scripts before real generation.
Do not automatically generate all 14 table recordings as part of this pilot.

Each increment includes tests, documentation and a demonstration before moving on.
The proposed execution scope after approval is 2A–2D, with the exact voice and
scripts agreed before real listening runs. Automatic public playback is a later batch.

## Verification and delivery boundary

Add focused coverage alongside the new feature and extend existing regressions:

- Store/jobs: room isolation, receipts, revision conflicts, input invalidation,
  cancellation, bounded retention and interrupted generation without blind retry.
- Gemini integration: shared quota/concurrency, profile mismatch and role directions
  outside the literal transcript; greetings retain their current behavior.
- Composition: correct order and real decoded duration, silence boundaries,
  mismatched profile rejection, final checksum and explicit over-limit errors.
- Tables: stale/failed voice replacement, code rename during a job, and unchanged
  QR/session contracts. Do not require a greeting record to prepare a call.
- Browser: desktop/mobile, keyboard, private listening, stop on close/navigation,
  state recovery after reload, and no public announcement or usage side effect.

After implementation, run focused tests for `server/Animation/Calls`, `server/Tables`
and changed Gemini contracts; changed-file ESLint and `npm run typecheck` apply.
Extend/add an isolated `config/karaoke-call-pilot.e2e.mjs` using the existing Gemini
fixture pattern, and run the affected audio scenarios in development and production.
Relevant existing commands are `npm run test:tables:e2e`,
`npm run test:greetings:audio` and `npm run test:transitions:player`.
Include the private HTTPS flow at `https://karaoke.puyu.pe/`; use isolated data for
destructive/failure cases and record actual acoustic acceptance separately.

Proposed new files are `shared/karaokeCalls.ts`,
`server/Animation/Calls/{Store,Jobs,Composition,router}.ts`,
`src/components/Animation/KaraokeCallPilot.tsx`, its styles, and a small
`TableVoice` component beside the existing table manager. Wire startup/shutdown
through `server/serverWorker.ts`. Reuse Gemini, audio preparation and UI components
instead of implementing another provider client or public player.

Rolling back the pilot removes its administrative surfaces, worker and routes;
existing table access, greetings and transition playback remain operational.
Internal generated files may be retained without becoming publicly eligible.

## Relationship to later batches

- **Batch 3:** expand accepted table voices to 01–14 and establish live static
  table-call fallback and greeting coexistence as already planned.
- **Batch 4:** reuse this pilot's generation/composition service for real approved
  singing requests. Resolve actual performer identity, clean song titles and
  preparation timing there. Preserve request table snapshots: never substitute a
  newly renamed table's audio for an older request silently.
- **Batch 5:** authorize, preload and play the ready composite through the existing
  coordinator. Never start a partial call while waiting for Gemini. Listening and
  house music retain general animator audio; karaoke replaces it with one call.
- **Batch 6:** venue acceptance using the actual screen, speakers and operator flow.

The shared two-second video/ambience lead-in, independent ambience level and batch 1
presentation remain the playback baseline. Batch 2 supplies accepted audio assets
and composition behavior; it does not activate the later public route.

Provider reference: [Gemini speech generation](https://ai.google.dev/gemini-api/docs/generate-content/speech-generation).
