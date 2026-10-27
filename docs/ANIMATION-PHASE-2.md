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
5. Open the venue player and use **Habilitar audio del animador** when requested
   by the browser. A pending manual request can wait for this gesture.

Preview is optional. Generating/uploading does not immediately broadcast audio.
Automatic operation still respects configured usage, profiles, sessions and
musical boundaries.

## Inventory

The three type tabs have different columns and forms. Search, state filters,
characteristic filters, sorting and pagination query the complete inventory.
**Filtros y columnas** exposes additional fields without expanding every row.

| Type | Characteristics |
| --- | --- |
| Voice | Spoken text, usage/event, voice, language, interpretation, profiles and promotion expiry |
| Effect | Description, category and profiles |
| Ambience | Description, category, loop setting and profiles |

**Detalles** provides metadata editing, download, activation/deactivation,
archiving and another generated version when applicable. Renaming does not
regenerate a file. Changing generated speech requires a new version, linked to
the original; original bytes/history remain intact. Archived resources can be
restored in a disabled state. Included shared assets are read-only.

Unknown metadata from uploaded or legacy files appears as **Sin especificar**.
Disabled resources can still be previewed/downloaded without becoming eligible
for venue playback. Preparation progress and errors belong to their resource row.

## Configuration

Configure credentials on the server, never in browser code or committed files.
The initial adapter is ElevenLabs; the architecture accepts additional adapters
without replacing the inventory or upload workflow.

| Variable | Purpose/default |
| --- | --- |
| `KES_ELEVENLABS_API_KEY` | Required for ElevenLabs generation, not uploads or existing local playback |
| `KES_ELEVENLABS_VOICE_ID` | Optional initial voice; the generation form retrieves compatible account voices |
| `KES_ELEVENLABS_MODEL` | Configured speech model, default `eleven_v4`; account availability is checked |
| `KES_FFMPEG_PATH` | `ffmpeg`; validates/prepares generated and uploaded files |
| `KES_ELEVENLABS_CHARACTER_LIMIT` | Internal monthly production allowance, default `10000` |
| `KES_ELEVENLABS_EFFECT_SECONDS_LIMIT` | Internal monthly effects allowance, default `300` |
| `KES_ELEVENLABS_BASE_URL` | Provider endpoint; override only for a trusted endpoint or isolated test fixture |

Existing optional price settings remain internal legacy accounting inputs.
The interface does not show estimates, credits or a consumption dashboard.
An actual provider rejection or configured limit is shown on the failed request.

Voice generation uses the configured speech model; effects/ambience use the
ElevenLabs Sound Effects endpoint. Only compatible capabilities appear in each
form. Upload accepts MP3, WAV or OGG, up to 20 MB, and verifies actual decodable
audio. Current duration limits remain **voice 10 s, effects 3 s, ambience 30 s**.
Longer ambience has not been approved or implemented. Files are never silently
trimmed or accelerated to satisfy these limits.

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
- **Confirmar celebración** requests the configured celebration voice and
  optional supporting effect. **Cerrar jornada** allows a bounded farewell.
- The rolling 120-second/10-minute voice/effect allowance and profile intervals
  remain internal scheduling controls. They do not describe provider credits.
- Promotions require expiry; the existing non-repetition/session rules remain.
- Session dates use `America/Lima`, initially with a 04:00 cutoff.

**Ambiente entre canciones** requires automatic mode and an open session.
It uses short renewable authority permits and yields to songs/announcements.
A loop-enabled resource can repeat; a non-looping resource ends at its boundary.
A paused/errored/loading song is not an idle room.

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
