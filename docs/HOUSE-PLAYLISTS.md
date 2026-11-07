# Reuse the venue's music every day

Saved playlists are the room's reusable repertoire. **De la casa** is the set
of songs prepared for playback now. Playing or removing a queued song does not
consume the saved playlist.

## Set up once

1. Open **Listas de reproducción** (`/admin/playlists`) and click **Nueva lista**.
2. Select the list and click **Agregar canciones**. In Biblioteca, open **⋯ Más
   opciones → Guardar en lista** on YouTube results, or use the save-list icon beside a local song. The
   destination is preselected; **Crear nueva lista…** is an alternative within
   the destination selector, not a competing form. After saving, click **Listo**.
3. Return to the list editor to move songs up/down or remove them. Rename and
   deletion are under **Opciones de la lista**.
4. Follow **Configurar en De la casa**, enable **Activar lista**, and leave
   **Repetir al terminar** enabled for continuous music. Click **Guardar cambios**.
5. Open the venue player and press **Reproducir**. Browser audio still requires
   the normal user interaction.

The room remembers its list and progress across reloads, server restarts and
days. There is no midnight reset, clock-based start or dependency on an animator
session. Reopening the player does not require rebuilding the repertoire.

Each screen has one responsibility:

| Screen | Responsibility |
| --- | --- |
| Listas de reproducción | Manage saved songs and their order; create/rename on demand. |
| Biblioteca | Find songs and save them to a selected list or enqueue them. |
| Cola → De la casa | Select, activate, repeat or restart the daily list. |

Playback configuration is no longer duplicated in the saved-list editor.
**Guardar cambios** and **Cancelar cambios** appear only for an unsaved draft;
navigating from the editor preselects a list without activating it. Editing
links preserve the selected list. Permanent help is reduced to **Cómo funciona**;
errors and disabled-action explanations remain visible when relevant.

## Import a YouTube playlist

1. In **Listas de reproducción**, choose **Importar desde YouTube**.
2. Paste a playlist link and press **Revisar lista**. Playlist links and video
   links containing `list=` are supported.
3. Review the eligible-song count, change the suggested name if needed, and
   expand **Ver canciones** or **Ver motivos** to inspect the result.
4. Press **Crear lista**. The editor opens the saved list in YouTube order.
   Follow **Configurar en De la casa** when you want to activate it.

The import is a one-time editable copy. It keeps the first occurrence of each
video and reports duplicates and unavailable videos. Source playlists above
200 entries are rejected explicitly; saved lists retain the existing 50-per-room,
200-song and 80-character-name limits. Long suggested names are shortened with
a visible explanation.

Administrators can import videos from any category, including recordings longer
than seven minutes. Category and length do not decide whether the selected
repertoire belongs in the venue. Individual searches and song requests retain
their existing Music-category and seven-minute rules.

Imports still require public, processed, embeddable videos with a valid positive
duration, excluding live/upcoming streams, age restrictions and configured-region
restrictions. Private playlists require a different, accessible link. Metadata
acceptance cannot guarantee future playback.

Reviewing does not save or queue songs. Confirmation saves the complete accepted
list in one transaction. Repeating confirmation after a lost response recovers
the same list through **Comprobar creación**. Reviews expire after ten minutes
or a server restart; check existing saved lists before reviewing again if a
previous creation response was lost. Creation does not activate house playback.

## Queue behavior

| Situation | Behavior |
| --- | --- |
| No approved karaoke requests | House songs play in saved order; repetition replenishes the list. |
| A karaoke request arrives during house music | The current song finishes; the participant is considered at the next boundary. |
| Multiple participant turns | Existing room configuration determines how many house songs are interleaved. |
| Interleaving is set to 0 | No house songs between participant turns; house music can still play when no requests wait. |
| Player is paused | Music stays paused. Preparing queue entries does not start playback. |
| List is disabled or changed | Only generated future entries are removed. The current song and manually queued songs remain. |
| Repeat is off | The repertoire is prepared once; use **Reiniciar lista** to start it again. |
| A saved song fails | That item is skipped for the active run and prepared copies are removed. The failure is visible. |
| Every item fails | Replenishment stops; review the songs and use **Reiniciar lista** to retry. |

Change the interleaving count in **Salas y mesas → room name → Configuración de
la cola de reproducción → Canciones de la casa entre turnos de participantes**.

For a one-off YouTube song, choose **⋯ Más opciones → Agregar a la casa** on
its search result. Local songs retain their explicit house action in the
expanded song controls.
That adds to the current house queue, not to a saved list. Normal and house
requests have separate receipt scopes, so confirming one cannot accidentally
retry it as the other origin. Participants retain their normal request flow
and cannot manage playlists or submit house-origin songs.

## Persistence and recovery

Migration `012-house-playlists.sql` adds room-scoped playlist metadata, ordered
validated song snapshots and the room's playback selection/cursor. It adds
optional playlist/run attribution to queue rows without changing existing
queue entries. Saved items retain IDs/metadata, not downloaded YouTube media.

Activating a list prepares its complete available cycle. A five-track list adds
five upcoming house songs, independently of `houseTracksBeforeParticipant`.
That setting controls only interleaving between participant turns.

Queue insertion and cursor advance commit together. A repeated cycle is
prepared only when no songs from the prepared cycle remain pending; repeated
status reports, reloads and startup reconciliation do not append extra copies.
The bound is one saved cycle (at most 200 entries), plus the current song.
Existing partial windows are completed from their cursor without restarting
playback. Replaying saved songs does not resolve them through the provider
again; actual playback can still fail if a file/video disappears.

**De la casa** counts pending songs, not the saved list's total. The count
decreases as songs start playing; when the last pending song starts, repetition
can prepare the next cycle so playback continues without a gap.

Disabling a list or changing repeat mode rewinds preparation to the last
actually playing/completed song before discarding buffered entries, so resume
does not silently skip songs that had only been prepared. Saved-order changes
affect future preparation; **Reiniciar lista** rebuilds the upcoming window from
the beginning, without cutting the current song.

Lists are limited to 50 per room and 200 distinct source IDs per list. Saving
the same source ID twice reuses the entry. Reordering validates the complete
item set; cross-room item/list identifiers are rejected.

## Verification

### Flexible imports — 2026-11-07

- Explicit `playlist` eligibility accepts other/unknown categories and recordings
  over seven minutes. `request` remains the default for individual search and
  resolution. Tests verify both policies using the same provider response.
- 120 focused tests, TypeScript, scoped ESLint and production builds passed.
  All 13 playlist E2E scenarios passed in development and production, including
  saving and queuing a 7:16 video categorized outside Music.
- The supplied `PLZnIg3ubO5mU` list yields 83 accepted videos out of 84.
  `-4EUIDc-J_0` is accepted at 436 seconds. `5pizyQuLKVA` is omitted because
  its owner disallows embedding.
- Verified keyboard import, omission reporting, creation and reload using the
  shared HTTPS frontend with an isolated production API and live YouTube data.
  Inspected mobile/desktop screenshots. This check does not claim new playback
  evidence or a shared-backend write.

Evidence: development `/tmp/karaoke-playlists-e2e-LJCZem`, production
`/tmp/karaoke-playlists-e2e-HrjKBM`, HTTPS UI
`/tmp/opencode/relaxed-playlist-3yQEZi`.

### YouTube import — 2026-11-04

- 100 focused source, playlist, URL and scheduler tests passed; TypeScript,
  scoped ESLint and server/client builds passed.
- 13 playlist E2E scenarios passed in both development and production. Import
  coverage includes pagination, ordered batching, omission reasons, private/
  oversized/empty lists, keyboard cancellation/focus, expired reviews, lost
  confirmation recovery, reload persistence and explicit house activation.
- Inspected mobile (390px) and desktop (1440px) import screenshots.
- Real HTTPS smoke at `https://karaoke.puyu.pe/` imported 91 of the sample
  playlist's 100 videos; nine were omitted for non-Music categories. Reload and
  activation succeeded, and `fRIhCiUVaKs` reached actual iframe playback
  (`currentTime > 1`, `paused=false`, `readyState=4`) in a temporary test room.
  The temporary room and administrator were removed after the check.

Evidence: development `/tmp/karaoke-playlists-e2e-skHh20`, production
`/tmp/karaoke-playlists-e2e-Ln7nEa`; HTTPS screenshots
`/tmp/opencode/youtube-import-https-{390,1440,player}.png`.
Implementation details: `odd/tasks/youtube-playlist-import.md`.

### Earlier saved-playlist checks

The full-cycle correction passed **39 focused playlist, cleanup and scheduler
tests** and **9 playlist E2E scenarios in each of development and production**.
The regression creates a list named **Nuevo** with five distinct tracks and an
interleave setting of two, checks five actual queue entries and the UI count,
reloads without duplicates, then plays all five in order before repeating.
Unit tests also cover interleave values 0/1/2/10 and upgrading existing partial
or wrapped windows. TypeScript, scoped lint, server build and diff checks passed;
mobile/desktop screenshots were inspected.

Full-cycle evidence: development `/tmp/karaoke-playlists-e2e-bVAwGS`, production
`/tmp/karaoke-playlists-e2e-ylVlZu`.

The initial backend/playback implementation baseline was:

| Check | Result |
| --- | --- |
| Complete unit/integration suite | 354 tests passed in 44 files |
| Saved-playlist E2E | 6 scenarios in development and 6 in production |
| Library E2E, including YouTube house/save actions | 9 scenarios in development and 9 in production |
| Existing playback/announcement E2E | 16 scenarios in development and 16 in production |
| TypeScript, scoped ESLint, server/client builds | Passed; existing dependency-license/bundle-size warnings remain |

The subsequent UI simplification passed **7 playlist scenarios and 9 library
scenarios in development**, plus TypeScript, scoped ESLint, diff checks and the
client production build. This includes native-dialog keyboard focus,
creation/rename cancellation, non-default list links, configuration draft
cancellation, exclusive existing/new save choices and duplicate-save feedback.
Mobile/desktop screenshots were inspected. Production E2E and the full unit
suite were not rerun for this UI-only refinement.

UI evidence: `/tmp/karaoke-playlists-e2e-G139B3` and
`/tmp/karaoke-library-e2e-3oKO5k`.

Playlist E2E uses real SQLite, authenticated APIs, Socket.IO, Chromium and a
generated local audio/video fixture. It verifies saved ordering, restart
recovery, house-only repetition, participant interleaving, pause/disable,
unavailable-file recovery and retained history. Library E2E uses a local
YouTube API fixture, including non-admin permission checks; no live quota is
consumed. Mobile/desktop editor and house-control screenshots were inspected.

```sh
npm test
npm run typecheck
npm run build:server
npm run build:client
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:playlists:e2e
KARAOKE_E2E_MODE=development PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:playlists:e2e
```

Temporary evidence directories:

| Suite | Development | Production |
| --- | --- | --- |
| Playlists | `/tmp/karaoke-playlists-e2e-91k1SZ` | `/tmp/karaoke-playlists-e2e-fMA6PV` |
| Library | `/tmp/karaoke-library-e2e-KUebyR` | `/tmp/karaoke-library-e2e-jtecsU` |
| Playback | `/tmp/karaoke-animation-e2e-5SB76A` | `/tmp/karaoke-animation-e2e-0rnTnF` |

The implementation plan is stored in Engram as `plan/persistent-house-playlists`
(observation #24072). Changes remain local; these checks are not a deployment
or a venue listening test.

### Rollback boundary

The work unit comprises migration 012, `server/Playlists`, queue attribution,
server reconciliation, idle HOUSE scheduling, the saved-list UI/routes and
Library destination/save integration, with their tests and documentation.
To roll back a deployed database, stop the server and restore a matching backup;
removing migration 012 discards saved playlist data. Preserve the earlier
administrative, participant and animator work.
