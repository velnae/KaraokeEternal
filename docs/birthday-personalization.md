# Birthday personalization

Birthday profiles select writing directions; the automatic greeting shares the
room's default voice and delivery with its preview. Approval, next queue slot and audiovisual sequence remain
the playback authority.

## Configure

### Queue workflow

The queue's compact birthday panel shows only unprogrammed or interrupted events:
name, state, **Escuchar**, **Programar** (or **Reintentar** after a failure)
and a more-options button. Listening opens a private audio/text dialog and never
programs a celebration or generates audio. The dialog contains editing, scene
selection, explicit regeneration/voice actions and cancellation; only one dialog
is open at a time. Its audio stops when closing, switching editors or programming.

Programming switches to the main queue tab. Scheduled/playing birthdays appear
only once in their actual queue position, with state, duration and **Retirar**
while scheduled. Withdrawing returns the existing event to prepared birthdays.
Cancellation removes it from pending while retaining its history, script and files.
Configuration and history remain in the dedicated birthday module.

### Room settings

1. Open **Ajustes → Proveedores de audio → Cumpleaños** for the current room.
   Existing installations retain ElevenLabs;
   new configurations default to Gemini text and Gemini Flash TTS.
2. Consult voices and select a default. In **Ajustes → Cumpleaños**, load/edit
   the five initial age profiles.
    Listen to the default voice before use. Switching provider preserves writing
    profiles and only requires selecting the new default voice.
3. Set writing directions and permitted approaches. Delivery is configured once
    on the provider page. Save settings.
4. Prepare a birthday with name, sex, birth year and optional public dedication.
    Advanced options override approach or writing profile. Preview before approval.

Age is computed for the celebration year in Lima. Resolution is exact age/sex,
then age/any-sex, then the default profile. Sex does not require a same-sex narrator.
Every newly generated greeting has at most **45 words in total**, including the
dedication, venue mention and both occurrences of the complete name. It starts
with **{nombre}…**, then continues after a brief natural pause. The speech style
reinforces that interpretation without adding spoken pause tags or splitting
the audio. Names whose repetition cannot fit the word budget are rejected before
provider requests rather than silently shortened. It includes **La pizzería Il Gatto se
suma con alegría** or an equivalent venue phrase, and ends exactly with
**¡feliz cumpleaños, {nombre}!**, with nothing after it. Server validation rejects
overlong or incorrectly ended results before speech synthesis; it never silently
truncates them. Measured audio must also satisfy the saved maximum (up to 60 seconds).

## Content and identity

The provider page owns the provider, speech/text models, default voice and delivery.
The birthday configuration screen groups greeting duration, compact age profiles and
the birthday scene. Profile dialogs use **Aplicar perfil** to update the local
draft; **Guardar cambios** persists the whole configuration. **Descartar** restores
the saved draft. Resource selection/upload stays behind **Cambiar**; original
settings and media IDs remain compatible. Introductions use the saved default
voice. Save provider-page changes before generating an introduction variant.

Voice tests explicitly distinguish **Generar prueba** from **Escuchar prueba**.
Samples are reused for the current page session by provider, speech model, voice,
delivery and processing revision. Changing writing settings or duration alone does
not invalidate the fixed-text sample; changing the speech identity does. **Generar
otra prueba** intentionally synthesizes a replacement. Closing a preview stops its
local audio/video. Reloading the page clears this client-side sample cache.

The full birthday preview automatically saves its latest edited name, script,
writing profile and media choices in SQLite, separately for each user and room.
Closing/reopening, refreshing the browser or restarting the server restores the
saved draft and matching prepared audio files. **Pruebas guardadas** restores a
sample's text and media choices. **Generar audio** reuses an identical sample;
**Generar otro saludo** explicitly generates a new variant. Editing name/text
requires matching audio before playback. Changing global voice settings keeps
the existing recording playable with an earlier-voice notice; **Generar con voz
actual** explicitly synthesizes the same text with the new settings.
An in-flight generation remains shared when the modal closes. The server records
its completed audio even if the browser disconnects; late results do not replace
newer saved edits. A user/room-scoped browser outbox retains unacknowledged edits
across refresh or logout, then submits them to SQLite with revision checks. It
never overwrites a different newer server draft. Logout clears runtime memory,
not saved trials or pending edits. Audio stays in the server media directory;
the browser outbox stores only draft fields and is cleared after acknowledgment.

Birthday and Karaoke saved trials have no automatic count-based eviction. New
samples retain their original draft selections; legacy samples recover known
text/voice/table identity and use current visual choices where no historical
snapshot exists. Unavailable audio is reported without deleting its association;
reopening retries storage access without synthesis. Saved Karaoke samples retain
their composition dependencies even after table voices change. Database startup
refuses missing applied migration files instead of automatically downgrading and
dropping persistent tables. Loading or restoring a trial never calls a provider.

- New `personalizationJSON` snapshots use version 3 and freeze the writing profile,
  approach, shared speech identity and anonymized recent openings.
- Historical references have been removed from selection, prompts and active UI.
  Old fields/transcripts remain readable for existing events; no new references
  are selected or appended. Raw demographics stay absent from public DTOs.
- The model integrates the optional dedication naturally before the closing, within
  the same 45-word budget. It is data, not instructions; no personal qualities or
  relationships may be invented when they were not supplied.
- Optional dedications are limited to 160 characters and validated as public
  content. Table numbers are supported; direct demographic disclosure is not.
- Three approaches rotate deterministically. An identical recent opening is
  rejected before speech generation, comparing the greeting body after the
  obligatory name/pause rather than rejecting its fixed prefix. Regeneration is
  explicit, not a paid loop.
- **Actualizar solo la voz** retains the transcript and regenerates audio from
  current saved voice settings. Editing content regenerates text and audio.
  Retries retain their snapshot. **Probar voz Flash-Lite** explicitly changes the
  speech model and requires another preview. Nothing is scheduled by these actions.
- Existing prepared files and legacy event snapshots remain valid. No migration
  synthesizes audio or changes a queued event's voice.
- Version 2 transcripts retain their previous 45-word/ending validation when
  reusing existing media; a fresh synthesis requires the new name-first opening.
- A new synthesis request, including an explicit revoice, must meet the current
  45-word/closing contract. If an old transcript does not, explicitly regenerate
  its text first; the previously prepared file is retained.
- Existing prepared preview samples remain reusable; only explicit new synthesis
  must meet the new text contract. Editing a name replaces whole names rather than
  partial matches inside longer words. The built-in sample adapts its length for
  multiword names without truncating a custom message.

Gemini uses server-side `KES_GEMINI_API_KEY`, a configurable text model, and a
saved TTS model. Speech uses `server/AudioProviders/Gemini.ts` with clean
transcript and separate `speech_metadata.style`. Model and catalogue voice access
are checked before synthesis. The birthday worker reports failures explicitly.

`server/AudioProviders/` owns Gemini and ElevenLabs clients, credentials, endpoints
and voice queries. Birthday prompts, saved profiles, preparation and playback
remain in the birthday module. Greeting/call request budgets and catalog production
budgets retain their existing scopes.

## Select and preview the celebration

1. In **Escena del cumpleaños → Introducción → Cambiar**, activate the saved
   variants to include in rotation. Upload audio or explicitly generate a named
   variant with birthday congratulations and a generic present from the house.
   Generated variants retain their approved text. Save the configuration.
2. In **Fondos de cumpleaños**, select a default video, then optionally assign a
   video by sex and age ranges within each sex. **Heredar** uses the sex video,
   or the default when the sex has no assignment. The option shows the effective
   inherited video and origin. Ranges for one sex cannot overlap; gaps inherit.
   Music remains one shared birthday song.
3. Preparing an event freezes its proposed introduction, background hierarchy and
   selected video's origin. Voice profile overrides do not change the background.
   **Configurar celebración** changes either resource for that event;
   **Volver a la propuesta automática** restores its saved proposal. Neither
   action rewrites the greeting or synthesizes speech. Withdraw scheduling before
   changing resources.
4. **Previsualizar celebración** plays the saved introduction, greeting and full
   song on this device, with the same muted background and name presentation as
   the player. Stop, restart or close it locally. A changed event stops its preview.
   Preview never schedules playback or records public introduction usage.
5. **Reproducir** schedules the celebration after the current song, or starts it
   when the player is genuinely idle. A paused song still occupies the player.

Rotation uses the current jornada, otherwise the Lima commercial day with the
room's configured cutoff (default 04:00). Selection balances actual public starts
and held/scheduled reservations, avoiding the previous introduction when another
variant exists. Cancelled reservations no longer count. Identical audio checksums
cannot appear twice in the active bank. Existing single-introduction settings
remain compatible. Reloads and retries keep their selections; settings changes
apply to new events. Public audio-start receipts count each playback run once,
including interrupted runs, and retain the jornada at its authorized start.

**Administrar videos → Subir video de cumpleaños** accepts H.264 MP4 files up to
2 minutes 10 seconds/40 MiB. General transition videos retain their 30-second limit.
The existing video validator checks and decodes the entire
file, strips audio and stores the result only in `birthdayAssets`. It never adds
the video to general transition rotation. Copying an existing general background
remains available and leaves that original's activation unchanged.

Legacy profile video assignments are materialized into independent age ranges
when settings are read/saved, preserving automatic age/sex precedence without
linking future voice edits to backgrounds. No SQL migration is required. Existing
events keep their media snapshots. Editing age/sex re-resolves the saved hierarchy;
a manual video stays selected until automatic restore. Revoice, regeneration and
settings changes do not replace an event's background. Missing selected media
remains an actionable preparation error rather than borrowing a general video.

## Birthday presentation

The shared player/preview presentation leaves the video unobscured and puts a
warm-yellow dedication near the bottom of the actual video frame. Letter outlines
and shadows provide contrast without a background panel. **🎂 ¡Feliz cumpleaños!**
appears above the name, which fits up to two lines without truncation. The video
keeps its complete aspect ratio, including on portrait screens. The birthday wording
remains visible through the introduction, greeting and final music.

The birthday wording fades in over 2 seconds during the introduction. The name
stays hidden until the generated greeting actually starts playing, then fades in
over 2 seconds and remains visible through the subsequent stages.
Neither line moves, and the sequence runs once per presentation.
Pause/resume preserves that entrance rather than replaying it; stage changes do
not restart it. Reduced-motion preference shows a still video frame and static
text without the entrance, revealing the name at the same greeting boundary.
Text animations do not alter audio timing.

## Add optional background audio

In **Escena del cumpleaños → Audio de fondo**, upload/select a saved track or
choose **Sin fondo**. Set **Volumen del fondo (%)** (default 20) and save. Tracks
may be up to 130 seconds; short tracks loop. They belong only to the birthday
catalog, independently of final music and video inheritance.

The background fades in two seconds before the introduction and accompanies the
personalized greeting. It continues alone for a 2.5-second bridge after the greeting,
fades out over the last 1.5 seconds of that bridge and is disconnected
before final music begins. The entry and bridge add 4.5 seconds to new events. Master volume/mute,
interruption, loss of player authority and grant expiration also apply to the
background. A missing or undecodable optional track produces a warning and the
celebration continues without accompaniment.

Events freeze their track and relative volume. **Configurar celebración** can
change either without regenerating speech; revoice/retry retain their snapshot.
The settings preview offers the same track/volume controls and shared audio-clock
envelope, with local pause/resume, restart and phase selection. Starting directly
at final music never starts the background. Closing/changing a preview releases
its audio nodes and private context without changing public playback.

Migration `050-birthday-background-audio.sql` preserves existing asset IDs, paths,
scripts and event references while adding the `bed` kind. Promotion bundles include
the optional track and preserve its volume. Existing settings default to no track.

## Finish with dedicated applause

In **Escena del cumpleaños → Aplauso de cierre**, upload/select and audition a
birthday-only audio file, then save. A short 3–5 second clip works well; the limit
is 10 seconds. This resource is independent of the Animator's effect catalog.

New celebrations and the full preview use the same sequence:

| Stage | Audio | Picture |
| --- | --- | --- |
| Entry, 2 seconds | Background only | Previous screen, before birthday video/text |
| Introduction | Introduction and background | Birthday video and birthday wording begin |
| Dynamic greeting | Greeting and background | Name fades in; birthday scene continues |
| Bridge, 2.5 seconds | Background only, fading at the end | Birthday scene continues |
| Birthday music | Complete song, without background | Birthday scene continues |
| Closing applause | Selected applause once, without background | Birthday scene stays until it ends |

Both joins use sequential fades, without overlapping tracks or trimming files.
Birthday music fades in over 1 second and fades out over its final 1.5 seconds;
applause fades in over 0.5 seconds and plays through its original end. Short clips
scale their fades to fit. Preview and public playback share the same audio-clock
envelopes. Pausing/resuming or changing volume preserves the current fade position;
restarting begins a new envelope. The preview routes its native audio element
through a gain node, resynchronizing after playback starts or seeks.

The event retains its media choices and choreography version. Older snapshots keep
their original sequence. New events without selected applause skip that final
effect; an unavailable/undecodable applause warns and releases the event normally.
No next turn may start before the closing effect finishes or is explicitly skipped
after a resource failure. Closing then reselects the next approved turn and runs
its normal transition/presentation, including when the birthday began from idle.
With no turn available, the player returns to its normal idle/ambience behavior.

Timed stages follow the audio clock; preview pause/resume preserves the remaining
entry/bridge time. Public cancellation, disconnect and authority expiry stop all
stages. Migration `053-birthday-applause.sql` preserves media IDs and private preview
references while adding the birthday-only applause kind.

## Review past birthdays

Open **Administración → Cumpleaños → Historial** (or **Ver historial** from the
queue). Search by name, creation dates in Lima or result. Results
include every retained event in the selected room, with 20 items per page.

Open a person's detail to read the saved script, play the stored audio locally,
inspect the selected profile/voice/history source and expand technical settings.
**Configuración** retains the original preset editor. Existing configuration
links can use `?view=settings`; history is the default birthday administration view.

History is read-only: it provides recorded event data, scripts, audio, settings
and errors without ratings or operator opinion forms.
Listening or browsing does not schedule playback, generate audio or consume
provider tokens. Historical provider usage and overwritten scripts cannot be
reconstructed by this view.

The history API (`GET /api/birthdays/history`, `GET /history/:id`
under the same birthday prefix) is administrator-only
and room-scoped. It returns explicit detail fields, not player authority tokens.

## Verification

```sh
mise exec node@24.22.2 -- npm test -- shared/birthdays.test.ts shared/birthdayVideos.test.ts server/Birthdays config/promote-resources.test.js
npm run typecheck
node config/birthdays.e2e.mjs
KARAOKE_E2E_MODE=development node config/birthdays.e2e.mjs
KARAOKE_E2E_LEGACY_BIRTHDAY=1 node config/birthdays.e2e.mjs
```

Build server/client targets before production E2E. E2E uses temporary databases,
real media preparation/playback, and fixture text/TTS providers. The HTTPS option
targets **dev-karaoke.puyu.pe**, checks tunnel availability, then routes worktree
HTML/assets/API/socket to the isolated server. It validates browser HTTPS behavior,
not deployment of this branch to the shared development service.
The isolated development fixture retains React development/StrictMode behavior
but freezes its initial webpack build, avoiding hashed-CSS replacement during a
scenario when other checkouts or editors change unrelated source files. Normal
development HMR and cache headers are unchanged.

| Criteria | Evidence |
| --- | --- |
| D01–D02 age profiles and precedence | `personalization.test.ts`, shared birthday tests |
| D03 literal transcript and separate delivery | `gemini.test.ts`, E2E provider assertions |
| D04 prompt and fixed-intro separation | Prompt assertions and content validation |
| D05 variety and duplicate rejection | Unit tests; no synthesis for duplicate openings |
| D06 public dedication and table numbers | Validator tests and form E2E |
| D07 exact-year/era facts and no-match behavior | Source URLs, snapshot and unit/E2E assertions |
| D08 private DTO allowlist | Public-projection and socket E2E checks |
| D09 selective regeneration and stable retries | Store/worker tests and operator revoice E2E |
| D10 legacy compatibility | Legacy-row tests and legacy E2E mode |
| D11 responsive/keyboard controls | Desktop/mobile screenshots; Enter submit/save; overrides |
| D12 playback and recovery | Development/production E2E, original socket/audio tests |
| D13 real voice quality | Pending an authorized audition with actual account voices |

Provider fixtures do not establish pronunciation, regional accent, creativity,
real account availability or exact cost. Use fictional difficult names and
multiple age profiles for the final acoustic check before public playback.
