# Search for a version and confirm its queue request

Administrators use **Biblioteca → YouTube** to search and add videos, or
**Archivos locales** to browse the existing local catalog. Participants use
the same video-type selector and request feedback in their mobile search view.
Both roles start with **Todos** selected.

Each YouTube result has one primary queue action. Administrators open **⋯ Más
opciones** on that result for **Agregar a la casa** or **Guardar en lista**.
There is no global queue-destination selector or permanent second save button. See
[daily house playlists](HOUSE-PLAYLISTS.md) to configure continuous playback.

## Operator workflow

1. Enter at least two characters of a song title or artist.
2. Choose **Karaoke**, **Con letras**, **Videoclip**, or **Todos**.
3. Check the title, channel and duration, then select **Agregar a la cola**.
   For another destination, open that song's **Más opciones**. Escape closes
   the secondary actions and restores focus to their trigger.
4. Wait for **Agregando…** to become **✓ En la cola**. The confirmation links
   to the queue. Participants use **Pedir canción** and see **Por aprobar**
   when the room requires moderation.

The filters refine the YouTube query; they do not certify the contents of a
video. YouTube's [`search.list` videoType parameter](https://developers.google.com/youtube/v3/docs/search/list)
only distinguishes `any`, `episode` and `movie`, not karaoke, lyrics or music
videos. The shared query helper adds relevant terms without duplicating
explicit format keywords. **Todos** uses the entered query unchanged.

## Request states

| State | Meaning / next action |
| --- | --- |
| Agregando… / Enviando… | Awaiting the server; repeat clicks are blocked. |
| En la cola / Por aprobar | Server-confirmed state; open the queue or personal requests. |
| Reintentar with an error | The request was rejected; resolve the displayed cause and retry. |
| Comprobar pedido | Acknowledgment was lost or timed out. Checking reuses the original request ID. |
| Sin conexión | Wait for reconnection; search resumes without resubmitting songs. |
| Límite alcanzado | Participants can review their pending requests before asking for another song. |

Request identities are stored per browser tab, account and room. The existing
request controller persists identity before transmission and updates the queue
only from server data. Confirmations never rely on a click alone. Searching
another type or reloading does not submit the song again.

## Implementation and verification

The latest action consolidation passed 9 development library E2E scenarios,
TypeScript, scoped ESLint, diff checks and the client production build. It
checks independent normal/house confirmations, hidden secondary actions,
keyboard/Escape/modal focus and mobile/desktop layouts. Same-query refreshes
retain result cards so an open action is not discarded during background search.
Evidence: `/tmp/karaoke-library-e2e-eihMqn`. Production E2E was not rerun for
this UI refinement; the broader baseline below predates it.

- `shared/youtubeSearch.ts`: shared search-intent terms.
- `src/components/SongSearch/`: accessible radio selector, result cards and
  the shared request hook backed by the existing participant controller.
- `src/routes/Participant/useYouTubeSearch.ts`: debouncing, stale-response
  rejection and reconnection for both interfaces.
- Local artist/song results retain virtualization. The library measures its
  remaining content area instead of waiting for the fixed header to grow.

```sh
npm run typecheck
npm test -- shared/youtubeSearch.test.ts src/routes/Participant/requests.test.ts src/routes/Participant/model.test.ts
npm run build:client
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:library:e2e
KARAOKE_E2E_MODE=development PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:library:e2e
```

Executed checks:

| Check | Result |
| --- | --- |
| Focused query/request/model tests | 12 passed |
| Library Playwright, development / production | 8 / 8 scenarios passed |
| Local playback/announcement regression, development / production | 16 / 16 scenarios passed |
| TypeScript, scoped ESLint, client build | Passed; existing build license/bundle warnings remain |

The library harness exercises both roles, keyboard format selection, stale
search responses, double-click deduplication, delayed acknowledgments, errors,
reconnection, reload, moderation, participant limits and responsive layouts.
Screenshots at mobile and desktop sizes were inspected. The playback harness
now selects **Archivos locales** explicitly and allows the eight-second test
song to finish when checking an announcement after a server restart.

YouTube Data API responses are simulated through a test-only Node preload
(`config/fixtures/youtube-fetch.mjs`) that requires a localhost fixture origin.
SQLite, authentication, Socket.IO and browser interactions are real. These
checks use no live YouTube quota and do not establish live result quality or
the playability of any particular external video.

Temporary evidence on the verification machine:

- Library development: `/tmp/karaoke-library-e2e-ZbMyob`
- Library production: `/tmp/karaoke-library-e2e-dmHR19`
- Playback development: `/tmp/karaoke-animation-e2e-TdjTxs`
- Playback production: `/tmp/karaoke-animation-e2e-vYoWDK`

This work unit can be rolled back by reverting the shared search components,
library/participant integration, query helper and associated tests/docs. It
requires no database migration or playback-coordinator change. Preserve the
earlier administrative and animator work when reverting it.
