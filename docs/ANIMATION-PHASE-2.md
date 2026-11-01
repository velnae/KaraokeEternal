# Animator: operate the room and manage its audio

Open **Ajustes → Animador**. **Control** operates announcements and sessions;
**Audios** manages the library. The **Ajustes** button opens occasional settings.
The queue remains dedicated to music.

## Quick path

1. In **Audios**, choose **Voz del animador**, **Efectos de apoyo** or
   **Ambiente de pausa**.
2. Use **Generar audio** or **Subir audio**. A successfully prepared resource
   becomes **Disponible** automatically; no review/publication step is required.
3. Use **Escuchar** to preview on this browser's current audio output. Preview
   does not send an announcement to the venue player. Only one preview plays
   at a time; leaving Audios releases it.
4. In **Control**, enable the animator. Choose a resource for an announcement
   at the next available pause, or choose **Automático** and **Iniciar jornada**.
5. Open the venue player. Audio prepares and activates automatically when allowed.
   If the browser blocks it, use **Reproducir** in that tab or the recovery button
   **Permitir sonido**. A pending manual request can wait for this gesture.

Preview is optional. Generating/uploading does not immediately broadcast audio.
Automatic operation still respects configured usage, profiles, sessions and
musical boundaries.

## Inventory

The three type tabs have different columns and forms. Search, state filters,
usage/category/profile filters, sorting and pagination query the complete inventory.
Columns are fixed by resource type. Row actions use play and information icons
with accessible names and tooltips. The global player-launch control is not
duplicated inside the animator panel.

| Type | Characteristics |
| --- | --- |
| Voice | Tagged script, usage/event, voice, profiles and promotion expiry |
| Effect | Effect type (short/transition), description, category and profiles |
| Ambience | Description, category, loop setting and profiles |

Effect categories use the same selector in generation, upload, Details, replacement
and inventory filters:

| Category | Recommended duration | Compatible type / maximum |
| --- | --- | --- |
| Agradecimiento | 2–3 s | Short / 4.5 s |
| Celebración | 3–4 s | Short / 4.5 s |
| Transición musical | 6–10 s | Transition / 12 s |
| Expectativa | 1.5–3 s | Short / 4.5 s |
| Aviso suave | 0.5–1.5 s | Short / 4.5 s |

Selecting a category selects its compatible type in the form. Recommendations
do not trim files, impose minimum durations or schedule playback. Existing audio
keeps its measured duration and generation history. Unrecognized legacy labels
remain readable until an operator assigns a standard category. Ambience retains
its separate descriptive categories.

**Detalles** provides metadata editing, download, activation/deactivation,
archiving and another generated version when applicable. Renaming does not
regenerate a file. Changing generated speech requires a new version, linked to
the original; original bytes/history remain intact. Archived resources can be
restored in a disabled state. Included assets have read-only metadata, but can
be deleted from the room's catalog.

**Detalles → Eliminar audio** stays visible beside **Descargar**, on the same row
of the fixed dialog footer, without scrolling the form. It works for generated,
uploaded and included demo resources. Deleting an included resource removes it
from this room's catalog and playback, including after restart; other rooms keep
their own access. Unlike archiving, deletion cannot be restored. Preparation, pending
announcements and active playback must finish or be stopped first; a blocked
deletion explains the next action. Usage and production history remain intact.
Deleting the currently previewed resource closes that local preview.

For uploaded resources, **Detalles → Reemplazar archivo** accepts a corrected
MP3, WAV or OGG without recreating the catalog entry. The original validation
error and the type's duration/size limits appear next to the file selector.
Short effects allow up to 4.5 seconds, so the previously rejected 4.1-second applause
can be submitted again through replacement. Files are not automatically trimmed;
an independently configured playback duration is deferred.

Replacement preserves the name, category, profiles, administrative state and usage
history. The server validates a separate candidate before switching files. If a
replacement fails, an existing valid file remains available. Successful replacement
closes a matching local preview. Generated resources continue to use **Crear otra
versión** so their synthesis provenance is not overwritten by an uploaded file.

Unknown metadata from uploaded or legacy files appears as **Sin especificar**.
Disabled resources can still be previewed/downloaded without becoming eligible
for venue playback. Preparation progress and errors belong to their resource row.

## Data directory

The server stores its inventory in `database.sqlite3` and media under `animation/`
inside its data directory. `--data` takes precedence over `KES_PATH_DATA`; otherwise
the platform's application directory is used. On this Linux installation the
verified directory is `~/.config/Karaoke Eternal Server/`.

Keep the same data directory across restarts and deployments. A different path
opens a separate inventory. Recovery from an older installation must transfer
the selected media and their inventory/production metadata into the current
database; importing them as ordinary uploads loses their generation provenance.

## Configuration

Configure credentials on the server, never in browser code or committed files.
The initial adapter is ElevenLabs; the architecture accepts additional adapters
without replacing the inventory or upload workflow.

| Variable | Purpose/default |
| --- | --- |
| `KES_ELEVENLABS_API_KEY` | Required for ElevenLabs generation, not uploads or existing local playback |
| `KES_ELEVENLABS_VOICE_ID` | Optional override; default Alejandro Duran (`sKgg4MPUDBy69X7iv3fA`). The voice must be available in the account. |
| `KES_ELEVENLABS_MODEL` | Configured speech model, default `eleven_v4`; account availability is checked |
| `KES_FFMPEG_PATH` | `ffmpeg`; validates/prepares generated and uploaded files |
| `KES_ELEVENLABS_CHARACTER_LIMIT` | Internal monthly production allowance, default `10000` |
| `KES_ELEVENLABS_EFFECT_SECONDS_LIMIT` | Internal monthly effects allowance, default `300` |
| `KES_ELEVENLABS_BASE_URL` | Provider endpoint; override only for a trusted endpoint or isolated test fixture |

Existing optional price settings remain internal legacy accounting inputs.
The interface does not show estimates, credits or a consumption dashboard.
An actual provider rejection or configured limit is shown on the failed request.

## Expressive voice scripts

For Eleven v4, write directions directly in **Texto del audio**, for example:

```text
[excited] ¡Bienvenidos a la noche de karaoke! [laughs]
```

Tags are highlighted in cyan. **Etiquetas de voz** offers documented suggestions
and inserts at the cursor; descriptive custom tags remain possible. There is no
Interpretación selector or automatically injected emotion. Spanish uses API code
`es`; accent and delivery depend on the selected voice. The generator does not
expose a redundant language picker for ElevenLabs.

The script permits up to 1,000 characters including directions, with at most
220 characters of spoken text; actual generated voice must still fit 10 seconds.
Directions stay in the generation prompt/cache identity but are stripped from
public display and semantic repetition comparisons. HTML and SSML are rejected.
This applies to administrator-authored catalog audio, not unrestricted client
greetings. Uploaded/legacy metadata is not silently rewritten.

Official sources checked for this change:
- [Eleven v4 prompting guide](https://elevenlabs.io/docs/overview/capabilities/text-to-speech/best-practices#prompting-eleven-v4)
- [Text-to-Speech playground FAQ](https://elevenlabs.io/docs/eleven-creative/playground/text-to-speech)

The provider documents tags as descriptive guidance, not an exhaustive enum or
a guarantee that every voice performs every instruction identically.

## Read-only usage history

**Uso en sala** shows confirmed public starts and the last start time. Resource
details include the current commercial day's count. Previews, generation,
reservations and requests cancelled before starting never increase these counts.

Migration `015-audio-usage.sql` adds the persistent room-scoped ledger. Confirmed
historical first-asset starts are imported idempotently. Historical secondary
effects and ambience were not individually acknowledged, so their tracking starts
with this version rather than inventing retrospective counts.

Effects register when their own segment starts, including cues before a voice.
Ambience counts once per selected-file episode across renewable permits and no-op
announcement probes. Switching to another file records its own start; real music,
speech, disable or loss of authority ends the episode. Interrupted audio with a
confirmed start still counts as heard. Uncertain unconfirmed starts remain
conservative scheduling evidence, but are not reported as confirmed usage.

Voice selection retains its persistent semantic/history rules, now ignoring tag
differences. Effect/ambience selection favours fewer uses in the current jornada,
then fewer historical uses and older last use. Counts are never cleared at
midnight or by opening another session; jornada dates follow the configured
Lima cutoff. The UI cannot edit these statistics.

## Audio preparation

Voice generation uses the configured speech model; effects/ambience use the
ElevenLabs Sound Effects endpoint. Only compatible capabilities appear in each
form. Upload accepts MP3, WAV or OGG, up to 20 MB, and verifies actual decodable
audio. Current duration limits are **voice 10 s, short effects 4.5 s, musical
transitions 12 s, ambience 35 s**. ElevenLabs Sound Effects generation remains
limited to 30 s per request; use upload/replacement for longer local ambience.
Files are never silently
trimmed or accelerated to satisfy these limits.

For longer musical separators, choose **Efectos de apoyo → Tipo de efecto →
Separador musical** when generating, uploading or replacing the file. Choosing the
**Transición musical** category also selects that type. Duration validation uses
the selected type, not the recommended range. Older effects default to
**Efecto breve**. Separators accompany presentations in the automatic program and
can also be requested from **Control**. They are never selected as celebration
applause. Each plays for its
full duration. Independent playback clipping remains deferred.

Uploaded effects can change type in **Detalles**. To change to a shorter type when
the current file is too long, use **Reemplazar archivo** and select both the new
type and a compatible file. Ready generated effects can also be reclassified when
the existing file fits the new type. Their original generation inputs remain
unchanged. Producing different sound or a shorter generated file uses **Crear otra
versión**.

FFmpeg rejects corrupt/silent/overlong media and prepares local MP3 output at
the existing target loudness: voice −16, effects −20, ambience −24 LUFS with
−1 dBTP. These are digital processing targets, not physical venue measurements.

## Automatic operation

- **Cena / Mixto / Fiesta** select room profiles. Configure event families,
  independent voice/ambience volumes and the session cutoff in **Ajustes**.
- **Iniciar jornada** creates one welcome opportunity. Reconnect, navigation
  and reload do not open another session or erase history.
- Real first/next-song boundaries can introduce a participant. Natural ending
  can produce a closing message. Skip/replay/errors are not natural endings.
- After the first presentation, natural song endings rotate eligible presentations,
  closings and generic celebrations even while more songs are queued. One voice
  is selected per boundary, preferring the least recently used family.
- Reuse of the same phrase has a finite 120/60/30-second cooldown in Cena/Mixto/
  Fiesta. Another eligible wording is preferred, but a single variant can return
  after cooldown. Environmental phrases are not exhausted for the whole jornada.
- In **Detalles**, generic celebration voices can use **Automática al finalizar
  canción**. Specific occasions retain **Solo con confirmación**;
  **Confirmar celebración** remains available for those events. **Cerrar jornada**
  allows a bounded farewell.
- Closing support uses category **Agradecimiento**, at most once per rolling
  ten minutes. Celebrations use **Expectativa → voice → Celebración**; presentations
  use **voice → Transición musical**; invitations/promotions can use **Aviso suave
  → voice**. Missing effect categories are simply omitted. Cena has
  no automatic support effects; missing/unprepared effects never block the voice.
- The rolling 120-second/10-minute voice/effect allowance and profile intervals
  remain internal scheduling controls. They do not describe provider credits.
- Invitations, booth messages and valid promotions rotate at the profile's
  environmental interval (20/12/8 minutes), both in idle time and between songs.
  Booth messages and promotions remain at most hourly; booth messages stay off in
  Cena. Promotions require expiry. A blocked family does not starve eligible ones.
- Session dates use `America/Lima`, initially with a 04:00 cutoff.

**Ambiente entre canciones** requires automatic mode and an open session.
It uses short renewable authority permits and yields to songs/announcements.
With multiple ready resources, each file advances to another at its natural end,
including non-looping files. With only one resource, its own loop setting applies.
A paused/errored/loading song is not an idle room.
The player renews the permit on the same audio source, rather than restarting
every ten seconds. Empty automatic-announcement probes do not interrupt ambience;
an expired permit still stops its audio on the Web Audio clock.

See [the real-audio rehearsal and operator acceptance record](ANIMATION-REHEARSAL.md)
for the scene sequence, configured development-room baseline and variant drafts.

There is no physical microphone state/control. Use the animator enable switch
and **Detener anuncio** for the audio the application actually controls.
Legacy microphone commands are rejected with a refresh instruction, and stored
legacy flags are cleared so they cannot silently block playback.

## Reliability and verification

Generation jobs remain durable and deduplicated. An uncertain provider response
is not automatically retried. A local registration failure exposes
**Reintentar preparación**, reusing the prepared file without another synthesis.
Navigation or closing a submitted form does not cancel server processing.

Run browser checks with an isolated database and simulated provider:

```sh
npm run typecheck
npm test
npm run build:server
npm run build:client
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium KARAOKE_E2E_MODE=development npm run test:animation:e2e
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:animation:e2e
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium KARAOKE_E2E_MODE=development npm run test:animation:phase2
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:animation:phase2
```

The generation harness exercises automatic availability, uploads, metadata,
disabled preview, download/archive, versions, session continuity, automatic
events, provider failure, large inventory and restart. The playback harness
checks real browser audio, pause/volume, stop/disable, standby/takeover and
StrictMode lifecycle. Mocked providers do not establish real-account voice
quality, billing or physical venue output.

See [audio catalog architecture and recovery](ANIMATOR-CATALOG.md) for migration,
provider extension, cache bounds and rollback details.
