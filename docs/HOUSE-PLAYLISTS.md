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

The server prepares only `max(1, houseTracksBeforeParticipant)` future songs,
plus the currently playing song. Queue insertion and cursor advance commit
together. Repeated status reports and startup reconciliation do not repeatedly
append the entire list. Replaying saved songs does not resolve them through
the provider again; actual playback can still fail if a file/video disappears.

Disabling a list or changing repeat mode rewinds preparation to the last
actually playing/completed song before discarding buffered entries, so resume
does not silently skip songs that had only been prepared. Saved-order changes
affect future preparation; **Reiniciar lista** rebuilds the upcoming window from
the beginning, without cutting the current song.

Lists are limited to 50 per room and 200 distinct source IDs per list. Saving
the same source ID twice reuses the entry. Reordering validates the complete
item set; cross-room item/list identifiers are rejected.

## Verification

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
