# Empty the queue or clean visible history

Administrators have **Vaciar cola** and **Limpiar historial** below the queue
filters. Both actions open a confirmation and apply to the current room across
all tables, regardless of the selected tab or table filter.

## Choose the action

| Action | Removes from view | Preserves |
| --- | --- | --- |
| Vaciar cola | Current song (playing or paused), all pending requests and visible history | Saved playlists and other rooms |
| Limpiar historial | Played, failed and rejected history entries | Current playback, pending requests, playlist selection and saved repertoire |

**Vaciar cola also disables automatic house-list replenishment.** The selected
list remains saved; reactivate it in **De la casa** when ready. The player receives
an explicit stop: media, position, current selection and queued advance/replay
intent are reset, and any in-flight transition is cancelled. New requests can
still arrive after a clear; they wait for explicit playback. This action does not
close admission.

The confirmation **¿Vaciar completamente la cola?** explicitly explains that
playback stops, all queue songs and visible history are removed, and saved lists
are retained. Cancel or Escape leaves the queue unchanged. History-only cleanup
still shows its preview count and reports the number of affected entries.

## When confirmation is lost

If the server acknowledgment is lost, the interface offers **Comprobar
resultado**, including after a page reload. This is a read-only lookup of the
original operation, not a repeated clear or another stop command. A newer
playback is therefore not interrupted by receipt recovery. If no operation was recorded, the
administrator must review and confirm again. A timeout never becomes an
automatic destructive retry.

## Persistence and scheduling

Migration `014-queue-cleanup.sql` adds cleanup receipts, a per-room generation
counter and `queue.historyClearedAt`. Terminal rows are retained internally:
cleaning visible history is not a database purge or a disk-space reclamation
operation. The retained rows preserve request deduplication, participant
rotation history and failed-playlist-item quarantine.

The server derives the room and current player from the authenticated socket;
it does not trust client-provided room/current-song IDs. Full clear covers all
room entries present when the transaction executes, including requests that
arrived after the confirmation opened. History-only cleanup uses its confirmed
queue-ID boundary and preserves current playback. Both use short-lived
confirmation and durable receipts. Asynchronous song resolutions that started
before the clear are rejected with an actionable response.

Current/pending removals, history visibility, house suspension, generation advance and operation receipt
commit together. Individual removal retains its `BEGIN IMMEDIATE` behavior;
bulk cleanup uses nested savepoints within the enclosing transaction. Late
player history reports cannot resurrect removed songs or erase visibility flags.
The server resets its cached playback status and ignores delayed reports for
removed media; a reconnecting player that missed the stop is also reset.

## Verification

- **65 focused tests passed across six files** for cleanup, player commands,
  media lifecycle, settlement and queue presentation. Coverage includes rollback,
  permissions, expiry, late status, reconnect, history-only preservation and
  receipt recovery that does not stop subsequent playback.
- **Five cleanup E2E scenarios passed in development and five in production**.
  They use real local audio, SQLite and Socket.IO with two rooms and an admin/
  participant pair. One browser acknowledgment is deliberately dropped to
  verify reload recovery without deleting a subsequent request.
- TypeScript, scoped ESLint, server/client builds and diff checks passed.
  Existing dependency-license and bundle-size build warnings remain.
- Development ran through the shared HTTPS frontend with isolated APIs and
  sockets. Mobile/desktop confirmation screenshots were inspected.

```sh
npm test -- server/Queue/cleanup.test.ts server/Player/socket.test.ts src/routes/Player/modules/player.test.ts
npm run typecheck
npm run build:server
npm run build:client
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:queue:cleanup
KARAOKE_E2E_MODE=development KARAOKE_E2E_HTTPS_UI=1 PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:queue:cleanup
```

Evidence (2026-11-07): development `/tmp/karaoke-queue-cleanup-e2e-Krw9pQ`, production
`/tmp/karaoke-queue-cleanup-e2e-18zdNz`. Tests use isolated data and no external
provider quota. Physical venue output is not part of this verification.

The work-unit rollback boundary is migration 014, the cleanup service/action,
queue visibility field/UI filtering, the playlist suspension helper and their
controls/tests. Preserve unrelated audio-resource work and migration 013.
Restore a matching database backup before rolling back a deployed schema.
