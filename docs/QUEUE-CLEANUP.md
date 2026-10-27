# Clear pending songs or clean visible history

Administrators have **Vaciar cola** and **Limpiar historial** below the queue
filters. Both actions open a confirmation and apply to the current room across
all tables, regardless of the selected tab or table filter.

## Choose the action

| Action | Removes from view | Preserves |
| --- | --- | --- |
| Vaciar cola | Pending approval and approved future requests, including participant, operator and house songs | Current playback, saved playlists and existing history |
| Limpiar historial | Played, failed and rejected history entries | Current playback, pending requests, playlist selection and saved repertoire |

**Vaciar cola also disables automatic house-list replenishment.** The selected
list remains saved; reactivate it in **De la casa** when ready. Pause is not
sent to the player, so a playing song continues and a paused song stays paused.
New requests can still arrive after a clear; this action does not close admission.

The confirmation shows a preview count and the whole-room scope. Cancel or
Escape leaves the queue unchanged. A successful response reports the actual
number of affected entries.

## When confirmation is lost

If the server acknowledgment is lost, the interface offers **Comprobar
resultado**, including after a page reload. This is a read-only lookup of the
original operation, not a repeated clear. If no operation was recorded, the
administrator must review and confirm again. A timeout never becomes an
automatic destructive retry.

## Persistence and scheduling

Migration `014-queue-cleanup.sql` adds cleanup receipts, a per-room generation
counter and `queue.historyClearedAt`. Terminal rows are retained internally:
cleaning visible history is not a database purge or a disk-space reclamation
operation. The retained rows preserve request deduplication, participant
rotation history and failed-playlist-item quarantine.

The server derives the room and current player from the authenticated socket;
it does not trust client-provided room/current-song IDs. Clear operations use
an immutable queue-ID boundary, short-lived confirmation and a durable receipt.
Newer manually submitted rows are preserved, while generated future house rows
are removed as replenishment is disabled. Asynchronous song resolutions that
started before the clear are rejected with an actionable response.

Pending removals, house suspension, generation advance and operation receipt
commit together. Individual removal retains its `BEGIN IMMEDIATE` behavior;
bulk cleanup uses nested savepoints within the enclosing transaction. Late
player history reports cannot resurrect removed songs or erase visibility flags.

## Verification

- Full suite: **377 tests passed in 47 files** on the current working tree.
- Eight new cleanup integration tests cover transaction rollback, room/current
  protection, immutable boundaries, lost-ack receipts, check-only lookup,
  permissions, expiry, stale song resolution, restart persistence, unchanged
  scheduling order and retained failed-track quarantine.
- **Four cleanup E2E scenarios passed in development and four in production**.
  They use real local audio, SQLite and Socket.IO with two rooms and an admin/
  participant pair. One browser acknowledgment is deliberately dropped to
  verify reload recovery without deleting a subsequent request.
- TypeScript, scoped ESLint, server/client builds and diff checks passed.
  Existing dependency-license and bundle-size build warnings remain.
- Mobile/desktop confirmation and queue screenshots were inspected.

```sh
npm test
npm run typecheck
npm run build:server
npm run build:client
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:queue:cleanup
KARAOKE_E2E_MODE=development PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:queue:cleanup
```

Evidence: development `/tmp/karaoke-queue-cleanup-e2e-KAMQO2`, production
`/tmp/karaoke-queue-cleanup-e2e-zYW0Bp`. Tests use isolated data and no external
provider quota. Physical venue output is not part of this verification.

The work-unit rollback boundary is migration 014, the cleanup service/action,
queue visibility field/UI filtering, the playlist suspension helper and their
controls/tests. Preserve unrelated audio-resource work and migration 013.
Restore a matching database backup before rolling back a deployed schema.
