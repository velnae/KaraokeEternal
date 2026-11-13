# Greeting speech with Gemini

Gemini generates personalized greetings while approved song requests wait in the
queue. The server validates and normalizes the audio, stores a private MP3, and
the player reads it before the corresponding song. Missing or late audio keeps
the greeting on screen without waiting for generation at the musical transition.

## Configure and try

1. Set `KES_GEMINI_API_KEY` in the server environment or root `.env`, then restart
   the server with its existing data directory. The standalone probe shares the
   provider client: `node --import tsx --env-file-if-exists=.env config/gemini-tts.js`.
   It prefers `KES_GEMINI_API_KEY` and also accepts `GEMINI_API_KEY` or
   `GOOGLE_API_KEY`; these aliases are exclusive to the CLI.
2. Open **Ajustes → Proveedores de audio → Saludos de participantes**.
3. Enable **Generar nuevas voces con Gemini**. Review the model, voice, delivery
   style and shared request limits, then select **Guardar ajustes**.
4. Select **Comprobar conexión** to validate access to model metadata. This does
   not generate speech or prove that the project's generation quota is available.
5. Select **Generar prueba de voz** for a private, normalized audio sample. This
   consumes one request from the same budget as greetings. Press the audio
   control's play button to listen in this browser; it does not publish to a room.
   Private previews also work before enabling automatic generation.
6. In **Animador → Saludos**, enable **Preparar voz mientras los pedidos esperan** for the current room.
   Enable **Leer saludos en voz alta** when the room should publicly read them.

Initial settings use `gemini-3.8-flash-lite-tts`, `Puck`, Latin American Spanish
with a neutral Peruvian accent, 3 requests/minute and 10 requests/day. Generation
starts disabled. Configuration is server-wide; preparation and public reading
remain room-specific. Reading also enables preparation; preparing alone does not
authorize reading. Disabling room preparation also disables reading.

Credentials are never stored in preferences, browser state or audio profiles.
The administrator can change nonsecret settings using revision-checked updates.
**Recargar ajustes** resolves a stale edit from another session.

**Llamados y plantillas** has an independent model, voice and style. It is initialized
once from the existing greeting settings. Changing participant speech to Lite does
not regenerate table numbers, introductions, prefixes or selected name recordings.
Generation enablement and request limits remain shared. Fixed call-bank audio is
prepared explicitly in **Animador → Llamados → Generar N audios de plantillas**.
The room's selected greeting introduction remains eligible with a saved sender
signature. A full listening presentation keeps its own introduction selection,
so two introductory clips are not added to the same sequence.

## Quotas and failure behavior

| Situation | Behavior |
| --- | --- |
| Missing key / disabled generation | Clear configuration guidance; visual delivery remains available. |
| Per-minute limit | Queue waits until the rolling-minute budget is available. |
| Daily budget or provider daily quota exhausted | New attempts use visual delivery; no rapid retry loop. |
| Explicit transient provider rate rejection | Persist its cooldown and allow at most one retry per job while still eligible. |
| Invalid key / permissions / depleted prepaid balance | Pause provider attempts until a successful connection check after correction. |
| Lost reply, timeout or interrupted server | Mark the outcome uncertain; never automatically resend it or block unrelated jobs. |
| Invalid, silent or oversized audio | Fail preparation; retain the visual greeting. |
| Cancellation, closed room or consumed turn | Abort local work and discard any late response. Remote processing/billing may already have happened. |

One generator is shared across rooms and private previews. SQLite stores request
reservations before sending, so failed/uncertain calls conservatively consume the
installation budget and restarts do not reset it. Daily counters reset at midnight
in `America/Los_Angeles`, including daylight-saving changes. The displayed counts
are local estimates, not Google's authoritative project balance. Other uses of
the same Google project can exhaust quota independently. Raising local limits does
not raise Google's limits or enable billing.

The worker never holds a song-submission transaction open. An uncertain result
does not imply that Google did not generate or charge for the request; automatic
recovery therefore favors visual delivery over duplicate generation.

## Preparation and private storage

- Only the recipient, message and sender are synthesized. The complete greeting
  remains limited to 220 characters. Participant text stays separate from the
  administrator's delivery instructions; inline audio tags are rejected.
- The provider uses REST `generateContent`, structured `speech_metadata.style`,
  and complete 24 kHz WAV responses. It bounds response bodies and sanitizes errors.
- FFmpeg validates useful audio, enforces a 20-second greeting limit and produces
  normalized MP3. Raw audio is limited to 20 MiB; prepared audio to 5 MiB.
- The room-private cache key covers normalized text, provider, model, voice,
  delivery style and processing version. Changing quotas or credentials does not
  invalidate an otherwise valid recording. Matching requests retain separate
  identities while sharing prepared bytes.
- Files live under `KES_PATH_DATA/greetings`. Checksums are verified before reuse.
  Terminal and ready jobs older than 30 days are removed when no pending or active
  greeting references them. In-flight temporary artifacts are removed on recovery.
- `GET /api/greetings/:greetingId/audio` serves only eligible recordings to an
  administrator in that greeting's room, with `private, no-store` headers. It
  respects `KES_URL_PATH` and does not expose recordings in the public catalog.

## Reading and musical transitions

The sequence is **background and ambience for about two seconds → catalog
introduction → complete greeting → song**. The same background and ambience cover
the next song's loading interval. Choose a generic **Presentación del saludo**
or **Sin presentación**. Singer name, table and singing/listening intent remain
visual; Gemini does not generate introductions or ambience. The selected intro is
reserved for greetings and excluded from general automatic announcements.

- Each musical request has its own greeting delivery, including successive songs
  in one participant turn. Participants add their message from **Mis pedidos** after
  song confirmation, until that song's transition is reserved. FAIR/FIFO rotation applies.
- The greeting reservation has a 25-second deadline, including a three-second
  startup allowance and fade. The two-second ambience lead-in precedes this
  reservation. Oversized introductions are omitted in favor of the
  greeting; speech is not truncated or accelerated to fit.
- A voiced card lasts for the speech duration, with a three-second minimum. A
  visual-only greeting uses the existing 10–15 second reading interval.
- Ambience uses the configured room ambience volume independently of voice volume,
  without automatic ducking. A finite transition permit can retain it through
  speech and loading. The next song starts muted behind the scene; after actual
  playback begins, the bed fades out before the music becomes audible.
- The authoritative player, socket epoch, persisted intervention lease and shared
  voice budget continue to govern playback. A duplicate player cannot read or stop
  the authorized greeting. Interrupted playback is not replayed after restart.
- Paused queues retain their greetings. Idle animator opportunities do not consume
  them. Playback uses preloaded audio and never calls the provider.
- **Retirar saludo**, **Pausar saludos**, announcement stop and musical controls
  interrupt delivery. Generic animator automation and greeting reading have separate
  enable switches; they share the voice volume.

## Migration from local voice

Migration `025-gemini-greeting-voice.sql` retires the old connection preference,
detaches local audio profiles without deleting greeting text, requests or delivery
history, and cancels their jobs for cleanup. It changes the single-worker index so
terminal uncertain cloud results do not keep the preparation queue locked. Existing
room reading preferences remain; the new global generator starts disabled.

The application no longer starts a Python model, manages a resident process or
uses a Unix socket/reference voice installation. Use the old server's normal
shutdown before deploying the replacement so it can release any process it owns.
An externally managed installation remains an operating-system resource under its
owner's control; upgrading the karaoke does not delete external directories.

To return to visual-only operation, disable room preparation/reading. Database
migrations remain installed. Binary rollback requires a matching database backup;
the migration's down path cannot reconstruct retired local configuration/cache.

## Verification

```sh
npm test -- server/Greetings server/Prefs/socket.test.ts
npm run typecheck
npm run build
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:greetings:audio
KARAOKE_E2E_MODE=development PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:greetings:audio
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:greetings:playback
KARAOKE_E2E_MODE=development PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:greetings:playback
```

The browser suites use isolated databases, HTTP provider fixtures, real QR admission,
FFmpeg, authenticated audio fetching, Web Audio sources and local MP4 playback.
They cover cache sharing, cancellation, uncertain restart, visual fallback,
keyboard controls, 390/1440px layouts, duplicate players, a nineteen-second greeting,
background video/ambience, and delayed player acknowledgments. Fixtures cannot send
real Gemini credentials to their local endpoint.

Set `KES_GREETING_TEST_AUDIO` to an existing recording to use it in the delayed
playback case. Automated suites do not request real cloud generation. A deliberate
private preview over `https://karaoke.puyu.pe/` validates the live credential,
generation and browser decoding separately. Pronunciation and physical venue
speaker levels require listening; successful automated decoding does not certify them.

References: [Gemini speech generation](https://ai.google.dev/gemini-api/docs/generate-content/speech-generation),
[rate limits](https://ai.google.dev/gemini-api/docs/rate-limits).

### Replacement verification

- 663 tests in 68 files passed with `npm test -- --maxWorkers=2`, plus typecheck,
  focused ESLint and server/client production builds. Existing browser-data,
  license-report and bundle-size build warnings remain.
- Greeting preparation passed in production and development StrictMode; playback
  passed all nine scenario groups in each mode. These runs used isolated data and
  simulated Gemini responses.
- Actual Chromium 109.0.5414.0 passed the player compatibility regression and
  keyboard-driven Gemini settings in production, and with the HTTPS frontend
  against an isolated development API. This does not certify Windows 7 drivers.
- The live HTTPS private preview generated a real Gemini MP3 (115,817 bytes,
  7.16 seconds). Browser decoding and completion succeeded without a media error.
  This consumed one real generation; automated suites consumed none.
