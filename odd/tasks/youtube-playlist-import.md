# Create saved playlists from YouTube links

**Status: implemented and verified, 2026-11-04.** The paste/review/create flow,
house integration and HTTPS playback check are complete. Evidence is below.

Admins paste a YouTube playlist link, review its name and eligible songs, and
create an editable room playlist. The existing **Configurar en De la casa**
action then leads to the separate playback configuration.

## Accepted behavior and first-version boundaries

| Area | Contract |
| --- | --- |
| Entry point | **Importar desde YouTube**, beside **Nueva lista** in `/admin/playlists`. |
| Import | A point-in-time copy into a new saved playlist; retain source order and the first occurrence of each video. |
| Availability | Read playlists accessible with the existing server API key; explain inaccessible/private playlists. |
| Eligibility | Reuse current Music-category, duration >0 and <=7 minutes, public/processed, embeddable, age and configured-region checks; exclude live/upcoming streams. |
| Limits | Keep 50 lists per room, 200 saved songs and 80-character names. For bounded initial imports, reject source playlists exceeding 200 entries with an actionable message rather than truncate them. |
| Preview | Editable suggested name, eligible count and omission reasons. Shorten long suggested names to 80 characters visibly. |
| Completion | Save all accepted entries together, select the created list and offer **Configurar en De la casa**. Creation itself leaves playback selection and queue untouched. |

The supplied playlist `PLfvBgYzp9y6QTdcVAL75Fw4EWw_PbZI8M` reported 100 videos;
the completed API check accepted 91 and omitted nine for non-Music categories.
A missing video response means unavailable/private/deleted; report that
combined reason when the provider does not identify the exact cause.

## Implementation sequence

Each unit includes its behavior tests. Follow the existing React/TypeScript,
Koa, SQLite and `HttpApi` patterns and reuse installed dependencies.

### 1. Preview a playlist through the existing YouTube adapter

- [x] Add `shared/youtubePlaylists.ts` for playlist-link parsing and typed
  preview/omission responses. Accept supported YouTube hosts and playlist or
  watch links containing `list`; keep single-video search behavior intact.
- [x] Extend the concrete adapter in
  `server/SongSources/YouTubeSongSource.ts`: fetch the title with `playlists.list`,
  paginate `playlistItems.list` in groups of 50, then batch `videos.list`.
  Share request/error handling and video eligibility with search/resolve;
  restore playlist order explicitly after batched lookups.
- [x] Add `server/Playlists/YouTubeImport.ts` and an admin-only
  `POST /api/rooms/:roomId/playlists/import/youtube/preview` accepting `{ url }`.
  Register the import endpoints in `server/Playlists/router.ts`.
  Return `{ previewId, suggestedName, songs, omissions }`. Keep resolved songs
  in a bounded server-owned preview cache, scoped to administrator and room,
  with a 10-minute lifetime; preview performs no database writes.
- [x] Test pagination beyond 50 items, shuffled metadata responses, duplicates,
  eligibility reasons, empty/all-rejected/oversized lists, invalid URLs,
  inaccessible lists, quota and provider failures. Assert batched requests
  and unchanged single-video search/resolve contracts.

**Checkpoint:** the preview endpoint returns an ordered, explainable import
candidate, including clear recovery messages when creation is unavailable.

### 2. Create the saved list atomically

- [x] Add `POST /api/rooms/:roomId/playlists/import/youtube` accepting
  `{ previewId, name }`. Apply the existing admin authorization and room
  validation to both endpoints; consume server-owned metadata only.
- [x] Add a bulk creation operation to `server/Playlists/Playlists.ts`, reusing
  existing song validation and storage. Recheck name, room capacity and item
  limits inside one SQLite transaction; commit the list and every item together.
  Complete external reads before opening that transaction.
- [x] Return the normal playlist snapshot plus `createdPlaylistId`. Repeated
  confirmation of the same valid preview returns the same list. An expired
  preview or server restart requires refreshing the preview and checking the
  saved lists if a prior response was lost. Reject zero eligible songs.
- [x] Test unauthorized access, cross-room/user preview use, expiry, repeated
  confirmation, a concurrent room-capacity change and rollback after an item
  insertion failure. Assert that creation preserves the active house selection,
  current song and existing queue.

**Checkpoint:** one confirmation produces one complete editable playlist;
provider or storage failure never leaves a partially created list.

### 3. Add the paste-and-create interface

- [x] Add `ImportYouTubePlaylistDialog.tsx` under `src/components/Playlists`
  and wire it into `PlaylistsView.tsx`. Use existing `Modal`, `Button` and
  `Playlists.css`; follow the loaded `frontend-design` skill and Spanish UI copy.
- [x] Flow: link field -> **Revisar lista** -> editable name/count/omission
  summary -> **Crear lista** -> selected saved-list editor. Keep omission
  details expandable and the next action visually primary.
- [x] Model loading, preview, saving, success and actionable error states.
  Explain disabled creation for empty/invalid results. Ignore stale responses
  after URL or room changes and prevent duplicate submissions.
- [x] Keep preview state separate from `usePlaylists.run`, which expects a
  `PlaylistSnapshot`. Use `HttpApi` for preview, refresh the saved-list snapshot
  after confirmation, and preserve the existing house-configuration link.
- [x] Add UI regression coverage for keyboard focus/Enter/Escape, cancellation,
  long names, omitted entries, expired previews and recovery after failure.
  Update `docs/HOUSE-PLAYLISTS.md` with the new import workflow and limits.

**Checkpoint:** an administrator can paste, review and create from either a
phone or desktop, then edit the result or configure house playback.

### 4. Verify import and house integration

- [x] Extend `config/playlists.e2e.mjs` with a local YouTube fixture using the
  existing `config/fixtures/youtube-fetch.mjs` preload pattern. Verify a
  multi-page import, reload persistence, omission reporting, repeated-submit
  protection and explicit house activation with temporary databases/ports.
- [x] Run the affected playlist scenarios in development (StrictMode) and
  production: saved order, continuous house playback, participant interleaving
  and failed-track skipping. Inspect mobile/desktop screenshots at 390/1440px.
- [x] Use Playwright at `https://karaoke.puyu.pe/` for the real import and an
  imported YouTube song reaching playback in a dedicated test room. Keep
  destructive fixtures off shared data. Record the accepted/omitted counts;
  metadata acceptance alone does not prove iframe playback.
- [x] Record commands/results and any pending HTTPS check in this document.

## Verification commands and development workflow

Run focused checks as each unit becomes available:

```sh
npm test -- server/SongSources/YouTubeSongSource.test.ts server/Playlists shared/youtubePlaylists.test.ts shared/youtubeSearch.test.ts src/routes/Queue/selectors/getRoundRobinQueue.test.ts
npm run typecheck
KARAOKE_E2E_MODE=development npm run test:playlists:e2e
npm run test:playlists:e2e
git diff --check
```

Lint the exact changed JS/TS/TSX/MJS paths with `npx --no-install eslint`.
For the production E2E command, build missing/stale targets once using
`npm run build:server` and `npm run build:client`. Reuse the running development
server and HMR, preserving `.env`, the data directory and tunnel settings.
If the tunnel is unavailable, complete local checks and mark HTTPS pending.

The implementation fits the existing saved-list tables and house scheduler.
Its rollback boundary is the new import UI/endpoints/cache and adapter additions;
already imported lists remain ordinary saved playlists. Preserve unrelated
worktree changes and record only actual verification evidence.

## Completion evidence

| Check | Result |
| --- | --- |
| Focused Vitest command above | 100 tests passed across six files. |
| `npm run typecheck` | Passed. |
| `npx --no-install eslint` on all changed JS/TS files | Passed. |
| `npm run build:server` and `npm run build:client` | Passed; existing license/bundle-size warnings remain. |
| Development playlist E2E | 13 scenarios passed; `/tmp/karaoke-playlists-e2e-skHh20`. |
| Production playlist E2E | 13 scenarios passed; `/tmp/karaoke-playlists-e2e-Ln7nEa`. |
| HTTPS real playlist | 91 accepted, nine omitted for CATEGORY; creation, reload and explicit activation passed. |
| HTTPS official iframe | Imported video `fRIhCiUVaKs` advanced to 1.857855 seconds, unpaused, readyState 4. |
| Visual inspection | Mobile/desktop fixture and HTTPS screenshots inspected; no horizontal overflow. |

The keyboard regression caught focus loss when removing the dialog; the import
trigger now receives focus on close. The first development run exceeded the
120-second command allowance; subsequent runs used 300 seconds. An open HMR tab
reported an obsolete CSS chunk during edits; reloading the refreshed index
resolved it. Final dev/prod suites report no page errors.

HTTPS evidence is in `/tmp/opencode/youtube-import-https-{390,1440,player}.png`.
The smoke test used a separate browser session and temporary room/administrator,
then removed its data. The existing venue room and admin session were preserved.
