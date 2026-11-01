# Validate the animator with the venue's audio

The software rehearsal uses the existing audio files, including their original
checksums. Operator listening is the remaining acceptance gate before producing
more variants. The music track in the automated rehearsal is a local test clip;
live YouTube playback and the venue speakers require the manual run below.

## Sustained automatic program

The initial one-shot rehearsal exposed a real defect: exclusion of the last phrase
had no expiry, environmental phrases were exhausted for the entire jornada, and
presentations starved closings while the queue stayed populated. These rules have
been replaced with a recurring program. More voice variants improve variety but
are no longer a prerequisite for continued operation.

- The first song can receive a presentation. Subsequent natural song endings
  alternate eligible presentations, closings and generic celebrations, preferring
  the least recently used family. Only one voice is selected per boundary.
- The same phrase becomes eligible again after 120/60/30 seconds in Cena/Mixto/
  Fiesta. Another wording is preferred when available. No phrase is permanently
  exhausted just because it was used earlier in the jornada.
- Invitations, booth messages and valid promotions get opportunities both in idle
  time and between songs. The environmental interval remains 20/12/8 minutes.
  Booth messages and promotions recur at most hourly; booth messages stay off in
  Cena. Unavailable families do not prevent other eligible families from playing.
- Generic celebrations explicitly marked **Automática al finalizar canción**
  enter the program. Birthday/name/specific-occasion clips retain **Solo con
  confirmación**. Welcome/farewell remain linked to jornada open/close.
- Voice/effect sequences use the existing 120-second/10-minute allowance and are
  bounded to 25 seconds. No announcement plays over music. Manual control and
  eligible visual greetings retain priority.

| Voice/event | Automatic effect placement |
| --- | --- |
| Presentation | Voice → musical separator |
| Closing | Voice → appreciation applause, at most once per ten minutes |
| Generic or confirmed celebration | Anticipation cue → voice → celebration applause |
| Invitation/promotion | Soft notification → voice, if such a resource exists |

Effects rotate within their category. Cena omits automatic support effects.
When multiple ambiences are available, the program advances at each file's natural
end, including non-looping resources. A lone looping resource remains continuous.
Finite authority is renewed without restarting a source; an expired permit still
stops audio. Paused/loading/errored songs are not idle ambience opportunities.

## Manual rehearsal

Use **Mixto**, voice at **50%** and ambience at **20%**. Both existing ambiences,
booth messages and valid promotions are now enabled. The existing generic
celebration is marked for natural song endings. The operator's current jornada
and usage history were preserved, not cleared to make the test pass.

1. Refresh **Ajustes → Animador → Control** and the main player. Confirm **Activado**,
   **Automático**, **Mixto** and **Ambiente entre canciones**. Audio activates
   automatically when allowed; if blocked, use **Reproducir** or **Permitir sonido**
   in the player tab. Use **Iniciar jornada** only if no jornada is open.
2. During genuine idle time, observe at least **70 seconds**: the pop and percussion
   files should enter the rotation automatically.
3. Queue several normal-length songs and let them finish naturally. Presentations,
   closings and generic celebrations should enter without individual requests.
   Hear separators after presentations, warm applause after eligible closings,
   and the drumroll before a generic celebration followed by celebration applause.
4. Continue through multiple rounds. The same available voice can return after
   its cooldown; neither exhausting one variant nor keeping songs queued should
   permanently silence the animator.
5. Confirm that the ten-minute closing-applause limit affects only that applause,
   not the whole program. Other voices/effects continue when eligible.
6. In a separate short run, skip a song and pause a loaded song. Neither action
   should produce a false natural-ending celebration or start ambience over the
   paused song. Use **Detener anuncio** once and verify that the queue remains usable.
7. Leave the room idle for the Mixto invitation interval (**12 minutes**). Listen
   for the invitation and the return of ambience. Finally select **Cerrar jornada**:
   one farewell, then silence from the animator/ambience channel.

### Acceptance record

Mark the final column only after listening through the actual output device.

| Situation | Resource / trigger | Expected | Automated evidence | Operator listening |
| --- | --- | --- | --- | --- |
| Welcome | Bienvenida a Il Gatto Karaoke; explicit open | Once per jornada | Real-catalog rehearsal | Pending |
| Presentation | antes de la siguiente canción; song boundary | Recurs with separator after cooldown | Twelve-song real-catalog rehearsal | Retest pending |
| Closing | agradecimiento breve + Aplauso cálido; natural ending | Participates with a populated queue; ten-minute applause limit | Repeated boundaries and controlled-clock tests | Retest pending |
| Celebration | generic celebration + redoble + celebration applause | Automatic natural-ending placement for the generic clip | Twelve-song real-catalog rehearsal, no confirmation command | Retest pending |
| Invitation | participar desde la mesa; eligible idle interval | No repeated insistence | Real audio with idle eligibility advanced only in isolated fixture | Pending |
| Farewell | cerrar la jornada de karaoke; explicit close | Once, then end ambience | Real-catalog rehearsal | Pending |
| Ambience | Pop and percussion; idle room | Rotates available files, yields to voice/music, resumes | Both files used automatically | Retest pending |

Record any issue with the row, profile, resource name and what was heard: too loud,
too quiet, cut, delayed, repeated or overlapping. A software PASS does not certify
pronunciation, perceived loudness or whether the atmosphere suits the venue.

## Repeat the automated rehearsal

The sustained-program rehearsal passed in production and development, with zero
audio/music overlap and no provider calls. It processes twelve songs without
manual announcement requests, verifies repeated use of the single presentation,
both other normal voice families, all five existing effects and both ambiences.
Separate isolated-history aging exercises invitation → booth → promotion →
invitation across recurring program windows. The live venue history is untouched.

- Production: `/tmp/karaoke-real-rehearsal-fw4iX7/report.json`.
- Development: `/tmp/karaoke-real-rehearsal-GI3Eym/report.json`.
- Manual regression: `/tmp/karaoke-animation-e2e-PtYCXq` (production),
  `/tmp/karaoke-animation-e2e-u1wRpU` (development).
- Automatic/catalog regression: 23 scenarios passed in production
  (`/tmp/karaoke-phase2-e2e-RLD1f6`) and development
  (`/tmp/karaoke-phase2-e2e-IkKHE3`).

The updated full suite passed 465 tests. Typecheck, scoped lint and builds passed.
The celebration-mode editor was checked with keyboard interaction and mobile/
desktop screenshots; a focused final layout check keeps its selector full-width.

These runs were headless. This execution environment has no desktop/audio-monitor
session, so the operator-listening column remains pending. The harness measures
disconnected sources as ended: event-listener ordering alone can otherwise report
a false sub-millisecond overlap after the application already disconnected a voice.

```sh
KARAOKE_REHEARSAL_DATA="$HOME/.config/Karaoke Eternal Server" \
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium \
npm run test:animation:rehearsal
```

Add `KARAOKE_E2E_MODE=development` for StrictMode. It creates an isolated room and
copies only ready catalog resources. It does not copy accounts, alter the venue
queue, or call a generation provider. The printed directory contains `report.json`
with asset checksums, audio start/end times and scenario results. On a desktop with
an audio output, `KARAOKE_REHEARSAL_AUDIBLE=1` opens a visible unmuted browser.

## Expansion after listening approval

The six core voice families currently have one usable voice each. Two additional
wordings per family produce **18 core voices**; booth/promotion clips are extra.
This expansion is optional variety, not a fix required to keep automation running.
Keep the current narrator voice and review one generated variant before submitting
the rest. The scripts below are drafts, not generated or acoustically approved;
their measured audio must fit the existing ten-second limit.

| Family | Draft variant 2 | Draft variant 3 |
| --- | --- | --- |
| welcome | [warmly] Qué gusto recibirlos en Il Gatto. ¡La música y la mesa se comparten! | [cheerfully] Bienvenidos a Il Gatto. Elige tu canción y disfruta la noche. |
| turn | [cheerfully] Ya viene otra canción. ¡Que siga la música en Il Gatto! | [warmly] Seguimos con una nueva canción para compartir. ¡Disfrutemos este momento! |
| closing | [warmly] Gracias por acompañarnos con esta canción. ¡Seguimos compartiendo buenos momentos! | [cheerfully] Una canción más para recordar. ¡Gracias por ser parte de esta noche! |
| invitation | [cheerfully] Tu canción favorita puede ser la próxima. Pídela desde el QR de tu mesa. | [warmly] ¿Te animas a cantar? Escanea el QR y elige tu canción. |
| celebration | [excited] ¡Hoy compartimos un momento especial! Un aplauso para celebrarlo juntos. | [cheerfully] ¡Qué lindo tener un motivo para celebrar! Disfrutemos este momento en Il Gatto. |
| goodbye | [warmly] Gracias por compartir sus canciones y su compañía. ¡Hasta pronto, de parte de Il Gatto! | [warmly] Cerramos nuestra noche de karaoke con mucho cariño. ¡Gracias y hasta la próxima! |

After the Mixto run is accepted, select ambience and calibrate levels separately
for Cena and Fiesta. Do not mark these profiles or the 18-voice expansion complete
until their audio has actually been prepared and reviewed.
