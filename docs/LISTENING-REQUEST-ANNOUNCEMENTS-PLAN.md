# Automatic listening-request presentations — implementation plan

**Status: implemented and technically verified. Real-voice listening acceptance is
pending; automated checks use isolated synthetic audio.**

Approved participant requests marked `LISTEN` get a reusable spoken presentation.
After one room-level activation, preparation and delivery run without per-request
operator actions or an open administration page.

## Delivery contract

Normal order: **general animator → request presentation → optional greeting → song**.

The presentation uses the existing table recording, one saved introduction and a
saved name, in that order, composed into one file:

> Desde la mesa cinco, Este pedido llega de parte de… Luis.

With a greeting, follow with its message only:

> ¡Feliz cumpleaños, Ana!

If the presentation is disabled or unavailable, the spoken greeting keeps its
attribution: `¡Feliz cumpleaños, Ana! De Luis`. Name suitability uses the same
resolution in both places; doubtful input becomes the saved `un invitado` audio.

- One setting: **Presentar pedidos para escuchar**, off by default on migration.
  Existing greeting, animator, generation and room/session controls keep authority.
- One complete introduction per presentation. The saved bank alternates between
  `Este pedido llega de parte de…`, `La siguiente canción la eligió…` and
  `Vamos con el pedido de…` initially. Administrators can extend and manage that bank
  from the existing settings page; no per-request selection is needed.
- Apply to approved participant `LISTEN` requests. Keep singing calls, house music,
  queue order and the incoming/`Después` visual presentation intact.
- Retain the existing scene/ambience lead-in. Select only ready assets that fit the
  current voice budget and transition ceiling. Reserve space for the greeting and
  its attribution first, then the presentation, then the optional general animator;
  play selected blocks in the normal order above. Long/unready greetings retain
  the existing screen fallback. Never wait for synthesis or cut spoken words.
- A presentation is at most 10 measured seconds. Greeting messages keep their
  existing limit and remain separate audio; do not concatenate an entire transition
  through the short-call composer.

## Implementation tasks

### 1. Reusable sources and preparation

- [x] Extend the existing `server/Animation/Calls/` contracts, store and worker for
  listening templates, names and the fixed `De` / `un invitado` sources. Use an
  additive migration after the latest schema; preserve table bindings and files.
- [x] Key reusable sources by room, role, normalized spoken text, provider/model,
  voice and delivery/processing version, never user, request or jornada. Fold case
  and whitespace for name identity but preserve accents and pronunciation variants.
  Deduplicate pending work as well as ready files.
- [x] Protect reusable sources from preview/jornada cleanup; retain temporary
  compositions while referenced by queued requests or active playback leases.
- [x] Add a local speech-suitability helper alongside `shared/guestName.ts`, separate
  from account validation. Cover `zz`, `AA`, `fgr`; accept ordinary short names such
  as Ana and Li. Avoid blanket vowel rules for other writing systems or a closed
  dictionary. Doubtful names use `un invitado`, without blocking requests, changing
  account names or generating the doubtful text. Keep existing moderation intact.
- [x] Prepare approved listening requests in the background through the shared
  Gemini gate, worker limits and receipts. Reuse tables unchanged and generate only
  missing sources. Prioritize upcoming requests; recover bindings after restart.
  Name/table/profile changes invalidate affected results; reorder alone does not.
  If no compatible table audio exists, compose template + name without inventing a
  table. If the presentation cannot be prepared, continue without that block.
- [x] Add focused reuse, concurrent admission, migration, retention and name-helper
  regression tests with provider fixtures and real local audio preparation.

### 2. Greeting attribution and one playback plan

- [x] Separate greeting message synthesis from its sender in
  `server/Greetings/voiceProfile.ts` and `AudioJobs.ts`. Version message-only cache
  identity; do not reuse signed legacy speech as unsigned speech or trim its words.
  Reprepare pending messages as needed, preserving history and public display.
- [x] Compose `De` + resolved name as a reusable signature. The same name source
  serves the presentation and signature. Do not generate two message versions.
- [x] Extend the existing transition planner to deliver one ordered, request-bound
  plan containing the selected general animator, presentation, greeting and required
  signature. Include attribution once: in the presentation, or with the greeting
  when no identifying presentation is included. Preserve sender attribution in
  existing singing/greeting flows when separating message synthesis.
- [x] Update `PlayerController.tsx` and `useGreetingPlayer.ts` to execute that plan
  through the current audio channel, reservation, epoch and start/end receipts.
  Replace the relevant greeting-versus-general branch, not the playback authority.
  If a presentation fails before delivery, retain an attributed greeting when
  safely playable; otherwise keep its attributed screen card and continue music.
  Do not automatically replay speech whose delivery was interrupted or uncertain.
- [x] Invalidate unstarted plans after cancellation, identity/profile changes or
  setting changes. Reuse existing stop/pause/skip/disconnect behavior for active
  playback. Changing presentation enablement must not cancel an otherwise valid
  greeting or regenerate its message.
- [x] Add planner and audio regressions for enabled/disabled/unavailable presentation,
  greeting presence, time-budget fallback, stale inputs and interrupted delivery.

### 3. Minimal control and end-to-end verification

- [x] Add the room switch in existing Animator settings, with concise Spanish copy,
  current styling and only actionable preparation/configuration feedback. Reuse
  existing private-listening controls for a prepared example. No extra dashboard,
  name approval queue or per-request generation buttons.
- [x] Extend the existing isolated call/greeting playback harnesses for listening
  presentations and repeated-name requests. Run the affected scenarios in development
  StrictMode and production, plus the development HTTPS flow with keyboard and
  mobile/desktop screenshots. Before HTTPS mode, replace any legacy production
  hostname in the affected harness with `https://dev-karaoke.puyu.pe/`.
- [x] Run focused tests, changed-file ESLint, TypeScript and `git diff --check`.
  Reuse dependencies/services; build only the targets needed for the production
  harness. Record actual results and remaining blockers here.
- [ ] Listen to real template/name/existing-table combinations for joins,
  pronunciation, volume and duration. Simulated-provider checks do not establish
  acoustic acceptance. Generate real samples only under an explicit approved scope.

## Completion checklist

Check these capabilities only after observing the stated result, not after merely
adding the corresponding code.

- [x] With administration closed, approved `LISTEN` requests prepare and announce
  automatically; pending/rejected/removed requests do not announce.
- [x] General animator precedes the personalized presentation when both are selected;
  an attached greeting follows it, then the correct song starts without voice overlap.
- [x] Existing table audio + one saved introduction + name produce one prepared
  presentation. Missing table metadata/audio never announces another table.
- [x] Repeated requests and different users called Luis share the name source;
  concurrent requests issue one name-generation attempt. Case/whitespace equivalents
  reuse it, while distinct accent/pronunciation or voice profiles stay distinct.
- [x] Names, templates and tables remain reusable after restart, preview cleanup
  and a new jornada. Fully cached sources require no new synthesis, and local
  composition still works with provider generation disabled.
- [x] Presentation on/off and unavailable-audio cases deliver an attributed greeting
  without a duplicate automatic sender signature or a second message generation.
- [x] `zz`, `AA`, `fgr` use `un invitado` without synthesis of those names; normal
  short/accented names work and existing moderation still applies.
- [x] Cancellation, edits, reorder, profile changes and restart never authorize stale
  speech; pause, skip, stop and disconnect prevent late continuation or duplicate use.
- [x] Provider delays, limits, failures and uncertain outcomes do not stall music or
  cause blind resubmission; the plan honors measured duration and voice budgets.
- [x] Greetings retain visible sender/message when speech is unavailable; singing
  calls, house music and the incoming/`Después` presentation pass focused regressions.
- [x] Migration preserves existing audio/history, defaults the feature off and handles
  pending legacy signed greetings without mislabeling their cached speech.
- [x] The switch persists per room, respects existing audio controls and works by
  keyboard on development HTTPS at mobile and desktop sizes.
- [x] Focused tests, lint, typecheck and isolated development/production playback pass;
  HTTPS evidence and real-audio listening acceptance are recorded separately.

## Delivery and checks — 2026-11-09

Open **Ajustes → Animador → Llamados** and enable **Presentar pedidos para escuchar**.
Use the existing shared voice settings for new synthesis and the normal automatic
animator controls for public playback. Sources prepare automatically; the collapsed
list provides private listening. Initial activation does not require one action per
name, table or request. The new switch defaults off and is independent of singing
calls and greeting playback.

- `042-listening-presentations.sql` adds the room flag and request bindings without
  deleting old greetings, audio or history. `Listening.ts` reuses the existing worker,
  quota gate, short composer, private audio API and authoritative reservation.
- Message-only cache versioning prevents signed legacy files from being mistaken
  for unsigned messages. Sender identity remains on screen. A presentation toggle
  affects future plans; an already-started sequence is not restarted or duplicated.
- Upcoming requests prioritize shared sources. Uncertain generation stays terminal
  until an explicit recovery attempt through the existing **Preparar mesas** action.
  Composition failures surface a fallback reason rather than an endless loading state.
- Focused coverage passed across Calls, Greetings, Animation, guest names, player
  audio and transition presentation (278 distinct cases across focused runs).
  Changed-file ESLint, TypeScript and whitespace checks passed.
- Server/client production builds passed. Client build retains existing dependency
  license and bundle-size warnings.
- Final call/listening E2E passed in isolated production and development StrictMode
  over `https://dev-karaoke.puyu.pe/`, using temporary API/socket data. The extended
  harness checks animator/presentation/message order, private listening, same-name
  reuse across QR guests and tables, feature-off signatures, neutral names, existing
  singing/house flows, provider fallback and pause/resume. Keyboard controls and
  mobile 390 / desktop 1440 screenshots were exercised and visually reviewed.
- Generic `transitions` diagnostics passed in development and production with captured
  playback traces. These are regression scenarios, not a production incident reproduction.

Final artifacts:

- Production call/listening harness: `/tmp/opencode/karaoke-call-pilot-6NAeLG`.
- Development HTTPS call/listening harness: `/tmp/opencode/karaoke-call-pilot-QK5UVk`.
- Generic transition evidence: ignored `.diagnostics/listening-presentations/`.

**Pending:** listen to real generated names/templates with the existing table bank
for pronunciation, joins and venue loudness. Synthetic tones validate sequencing,
duration and reuse, not speech quality. No paid synthesis or production operation
was used for these checks.

### Node 24 parity follow-up

The initial checks above used Node 26.12 and did not establish production runtime
parity. All verification now selects the documented production **Node 24.22.2**
through `mise exec node@24.22.2 -- ...`, as required by `AGENTS.md`.

A new generic-fallback regression reproduced a SQLite parameter error on Node 24
before the correction: the no-table fallback attempted to bind an undefined table
part ID. `CallJobs` now queries that part only when present. Unexpected errors are
logged with job context and no longer automatically blamed on FFmpeg.

Under Node 24.22.2, Calls Jobs (15), Automation (22) and migration (5) tests passed,
along with TypeScript, changed-file ESLint and backend compilation. The complete
isolated call/listening playback harness passed in production
(`/tmp/opencode/karaoke-call-pilot-MnxUgV`) and development StrictMode over HTTPS
(`/tmp/opencode/karaoke-call-pilot-ausbj7`). Existing failed jobs require the normal
**Preparar mesas** retry; the correction does not reset live jobs or regenerate the
table bank as a side effect.

## Admin-managed listening introductions

In **Ajustes → Animador → Llamados → Introducciones para escuchar**, use
**Agregar introducción**, enter the opening phrase and select **Generar y guardar**.
The example below the field shows how it joins the reusable name and table audio.
A successfully prepared introduction becomes eligible automatically. **Escuchar**
is private to the current browser; the checkbox controls rotation and the menu
provides **Editar** and **Archivar**. Failed or uncertain preparation exposes an
explicit retry instead of silently submitting another generation.

- Migration `043-listening-templates.sql` imports the three defaults and compatible
  saved audio, and binds pending presentations to stable template/source IDs.
  Adding entries does not redistribute pending requests. Editing keeps the previous
  usable version until replacement succeeds; already assigned source versions remain
  immutable. Disabling/archiving prevents future selection without cutting started
  speech. With no active sources, music continues and greetings retain attribution.
- `ListeningTemplates.ts` stores room-scoped metadata and delegates synthesis to
  the existing worker. New failed sources do not displace usable alternatives.
  Greeting-signature identity is independent of template-bank changes, protecting
  a greeting already playing while new introductions become available.
- The existing calls API supplies the bank in its snapshot and accepts admin-only
  create/update/retry operations under `karaoke-calls/listening-intros`. Plain-text,
  duplicate, version, room-ownership and lost-acknowledgment checks are covered.
  No public-catalog registration, new provider or additional scheduler is introduced.
- `ListeningTemplateManager.tsx` reuses the theme, modal and private player. It has
  one text field, a composed textual example, keyboard menus and explicit focus
  entry/return. Singing introductions are labeled **Introducciones para cantar**.

Verification with **Node 24.22.2**: 142 distinct focused cases passed across template
management, migrations, call preparation/automation, greeting/animation coordination
and the audio channel. TypeScript, changed-file ESLint and both verification builds
passed. The final extended E2E passed in isolated production
(`/tmp/opencode/karaoke-call-pilot-Xbxi0B`) and development StrictMode over HTTPS
(`/tmp/opencode/karaoke-call-pilot-g3ttPH`). The admin journey covers creation,
preview without public usage, persisted activation, editing, archiving, provider
failure/retry and unchanged pending assignments. List and editor screenshots were
reviewed at 390 and 1440 pixels, including Escape and focus return.

An initial HTTPS run completed speech but timed out before starting its song;
the failure artifact is `/tmp/opencode/karaoke-call-pilot-obcdLG`. Subsequent isolated
production/HTTPS runs passed; no cause was established for that one handoff timeout.
The harness now captures player text, screenshot and playback trace on recurrence.
All synthesis in verification used fixture audio, not paid generation.

### Table-first composition

Listening presentations now compose **table → introduction → name**. Text and voice
sources are unchanged; requests without a usable table still use introduction → name.
The admin example shows the same order. Priority/error lookup text follows the
ordered composition as well.

Only the listening request recipe advances to `listening-v2`; the shared
`compositionRevision` and synthesis/cache identity remain unchanged. Pending legacy
requests are reassembled locally from cached sources. Confirmed `listening-v1`
presentations retain their original identity and file until they finish, without
allowing replay or bypassing changed-name/profile validation.

Node 24.22.2 checks: 34 preparation/template regressions, TypeScript, changed-file
ESLint, backend compilation and the required client verification build passed.
The call/listening harness passed in production (`/tmp/opencode/karaoke-call-pilot-B5V86W`)
and development StrictMode over HTTPS (`/tmp/opencode/karaoke-call-pilot-dwLbT3`).
Checks include ordered source dependencies, table-first text, no-table behavior,
cached-source reuse and legacy pending/started cases. The admin example was
visually reviewed at 390 and 1440 pixels. No new spoken wording or paid synthesis
was introduced by this change.

## Code and reference map

- `shared/karaokeCalls.ts`, `server/Animation/Calls/` — reusable sources, jobs,
  request preparation, composition and playback planning.
- `shared/guestName.ts` — existing account-name rules; add speech suitability nearby.
- `server/Greetings/{voiceProfile,AudioJobs,transition,Greetings}.ts` — message cache,
  attribution, request binding and reservation.
- `src/routes/Player/components/PlayerController/PlayerController.tsx` and
  `src/routes/Player/components/Animation/` — existing playback channel and execution.
- `src/components/Animation/` — existing settings, controls and private listening.
- [Automatic karaoke calls](AUTOMATIC-KARAOKE-CALLS-PLAN.md) and
  [contextual transitions](TRANSITION-ANNOUNCEMENTS-PLAN.md) — compatibility baseline;
  this plan extends listening behavior, not the delivered singing-call contract.
