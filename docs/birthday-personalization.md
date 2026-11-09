# Birthday personalization

Birthday profiles select writing directions and a saved speech identity before
generation. The existing approval, next queue slot and audiovisual sequence remain
the playback authority.

## Configure

1. Open **Ajustes → Cumpleaños**. Existing installations retain ElevenLabs;
   new configurations default to Gemini text and Gemini Flash TTS.
2. Consult voices, select a default and load/edit the five initial age profiles.
   Candidate voice names are suggestions, not evidence of availability or accent.
   Listen to each chosen profile before use. Switching provider clears unsaved
   voice assignments rather than interpreting one provider's IDs as another's.
3. Set writing directions, delivery, permitted approaches and historical frequency
   (`0` disables history; default `4`). Save settings.
4. Prepare a birthday with name, sex, birth year and optional public dedication.
   Advanced options override approach or voice profile. Preview before approval.

Age is computed for the celebration year in Lima. Resolution is exact age/sex,
then age/any-sex, then the default profile. Sex does not require a same-sex narrator.
The greeting targets 25 seconds; measured audio must satisfy the saved maximum
(up to 60 seconds). The prompt reserves words for dedication and history.

## Content and identity

The configuration screen groups the default greeting, compact age profiles and
the birthday scene. Profile dialogs use **Aplicar perfil** to update the local
draft; **Guardar cambios** persists the whole configuration. **Descartar** restores
the saved draft. Resource selection/upload stays behind **Cambiar**; original
settings and media IDs remain compatible. Introductions use the saved default
voice, so unsaved default-voice changes must be saved before generating a variant.

Voice tests explicitly distinguish **Generar prueba** from **Escuchar prueba**.
Samples are reused for the current page session by provider, speech model, voice,
delivery and processing revision. Changing writing settings or duration alone does
not invalidate the fixed-text sample; changing the speech identity does. **Generar
otra prueba** intentionally synthesizes a replacement. Closing a preview stops its
local audio/video. Reloading the page clears this client-side sample cache.

- `personalizationJSON` freezes profile, approach, speech provider/model/voice/style,
  recent anonymized openings and the source/version of the selected reference.
- The historical catalogue in `server/Birthdays/personalization.ts` starts with
  source-reviewed NASA/CERN events and truthful era variants. Exact-year links
  require an exact match. Missing references produce a normal greeting.
- A birth-linked historical phrase is intentionally public and can make age or
  birth year inferable. Raw demographic fields remain absent from public DTOs.
- The server appends the verified historical clause and authorized dedication
  literally. The model writes the creative portion without duplicating those
  clauses. This prevents fabricated/reworded factual clauses from being trusted.
- Optional dedications are limited to 160 characters and validated as public
  content. Table numbers are supported; direct demographic disclosure is not.
- Three approaches rotate deterministically. An identical recent opening is
  rejected before speech generation; regeneration is explicit, not a paid loop.
- **Actualizar solo la voz** retains the transcript and regenerates audio from
  current saved voice settings. Editing content regenerates text and audio.
  Retries retain their snapshot. **Probar voz Flash-Lite** explicitly changes the
  speech model and requires another preview. Nothing is scheduled by these actions.
- Existing prepared files and legacy event snapshots remain valid. No migration
  synthesizes audio or changes a queued event's voice.

Gemini uses server-side `KES_GEMINI_API_KEY`, a configurable text model, and a
saved TTS model. Speech uses the existing `GeminiGreetingTts` transport with clean
transcript and separate `speech_metadata.style`. Model and catalogue voice access
are checked before synthesis. The birthday worker reports failures explicitly.

## Select and preview the celebration

1. In **Escena del cumpleaños → Introducción → Cambiar**, activate the saved
   variants to include in rotation. Upload audio or explicitly generate a named
   variant with birthday congratulations and a generic present from the house.
   Generated variants retain their approved text. Save the configuration.
2. Set the general background and optionally select **Video del cumpleaños** in
   each profile. A profile without a video uses the general background. Music
   remains one shared birthday song.
3. Preparing an event freezes its proposed introduction and profile background.
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
npm test -- shared/birthdays.test.ts server/Birthdays server/Greetings/GeminiGreetingTts.test.ts
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
