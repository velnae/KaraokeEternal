# Table QR admission

Each room can associate singers and song requests with physical tables. QR codes
remain fixed until an administrator renews them. Table admission does not change
participant-based queue rotation or request ownership.

## Start using tables

1. Open **Administrar → Salas → Mesas** for the room.
2. Select **Nueva mesa**, enter a unique code and optional name, and save.
3. Expand **Acceso de cantantes**, set **Acceso por mesas** to **Opcional**, and
   select **Guardar modo**. The collapsed header always shows the saved mode.
4. Open **Ver QR** to download or print one table, or use **Imprimir mesas activas**.
5. Scan a card in a different browser/device. The entry form displays the table
   above the singer's name. Existing accounts can also enter through this link.
6. Select **Estricto por QR** when every singer should enter through a table.

Use **Buscar mesa** to filter by code/name and **Estado de mesas** to find active,
disabled, or archived tables. Archived tables are hidden by default. **Editar**
opens a focused dialog; canceling or pressing Escape discards the draft.
**Ver QR** opens a printable preview. Expand **Gestionar** on a table for renewal,
session closure, deactivation, and archiving. **Volver a salas** returns to the room list.

Generate cards while using the public address guests can reach, not a localhost
address. Links preserve the application's configured URL prefix. Room passwords
and guest/account creation permissions still apply.

If a scan reports **El ingreso por mesas está desactivado**, the QR may still be
valid: enable optional or strict access in its room and save. Creating tables alone
does not enable admission. Existing cards do not need renewal for this change.

## Access modes

| Mode | Singer admission |
|---|---|
| Desactivado | Existing entry flow; new requests have no table attribution. |
| Opcional | Normal entry without a table, or a validated table QR. |
| Estricto por QR | A valid participation session from an active table is required. |

Changes take effect when saved, including for already-connected singers. The
administrator remains able to manage the room independently. At least one active
table is required to activate strict mode. Disabling all tables afterward is
allowed and stops new table admissions.

## QR and session controls

| Action | Effect |
|---|---|
| Renovar QR | Invalidates the old link for new admissions. Replace the printed card. Existing sessions continue. |
| Cerrar sesiones | Revokes current participation at that table. The printed QR remains valid for new entry. |
| Desactivar | Stops new entry and revokes current participation. Reactivating does not restore revoked sessions. |
| Archivar | Retires the table and revokes participation. Its code remains reserved in the room. |
| Editar | Changes the code/name without changing the QR. Existing request labels remain unchanged. |

Participation lasts 12 hours from admission; reconnecting or editing a profile
does not extend it. The same valid table scan reuses the session. Another table
requires confirmation and replaces the previous participation session. Multiple
singers may share a table; the account is not permanently assigned to it.

After expiry or revocation, scanning a valid QR recovers the existing account
identity. In optional/off mode, **Continuar sin mesa** explicitly clears table
participation. A room password, if present, is still required.

Closing participation leaves already-accepted songs in the queue and does not
interrupt playback. The operator can remove songs through the existing queue UI.
Use **Filtrar por mesa** to locate requests. Counts in table administration are
active participation sessions and pending songs, not physical occupancy; use
**Actualizar** to refresh them.
Refreshing also reloads the saved access mode without discarding an unsaved
selection in the access form.

A printed QR grants access to anyone holding its link. It is not proof of
physical presence. If both a leaked link and its existing sessions must be
invalidated, renew the QR and close the table's sessions.

## Data and recovery

Migrations `008-room-tables.sql` and `009-table-participation.sql` add only two
entities plus nullable request context. Existing rooms default to OFF; existing
queue items retain null table fields. A request stores its table label at creation,
so transfer, rename, and retries do not rewrite its original attribution. Normal
queue/user/room retention rules still apply; this is not a permanent reporting
archive or billing system.

Back up the SQLite data before upgrading. To temporarily disable the feature,
save **Desactivado** and retain the migrations. Do not treat an older binary as a
data-preserving rollback: this repository's migration runner executes Down for
migration files missing from that build, removing the new data. Restore a matching
backup if a binary/schema downgrade is necessary.

## Verification

Focused automated coverage:

```sh
npm test -- server/Tables
npx tsc -p config/tsconfig.server.json --noEmit
```

Run the headless production-browser scenario after building:

```sh
npm run build:server
npm run build:client
npx playwright install chromium
npm run test:tables:e2e
```

Alternatively, use an installed Chromium without downloading a browser:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:tables:e2e
```

The harness creates its own temporary database and server on a temporary port,
uses `/karaoke/` to exercise prefixed deep links, and closes browsers/server in
cleanup. It prints its artifact directory for screenshots and logs. No production
account, songs, or preferences are required. Browser automation opens the encoded
QR destination; printing and layouts are checked headlessly, not with a physical
camera/printer. Local queue submission uses a metadata fixture; external YouTube
playback is covered separately by existing provider/player tests rather than a
live network video in this harness.

### Delivered work units

| Delivery | Evidence | Operational fallback |
|---|---|---|
| Table administration | Model and HTTP permission/isolation tests; browser creation | Keep mode OFF; retain table records. |
| Optional admission | Guest/registered QR entry, same-table reuse, transfer, password and snapshot tests | Use OFF; historical snapshots remain. |
| Strict admission | Existing-socket rejection, expiry, invalid QR, revocation and post-resolution validation | Save OPTIONAL/OFF; retain session validation. |
| Table operation | Download, print preview, table filter, mobile layouts | Basic table admission remains usable without convenience views. |
| Upgrade and release checks | Legacy database upgrade, restart persistence, all-mode headless scenarios | Matching database backup for schema downgrade. |

Validation on 2026-10-25: 262 unit/integration tests passed and 16 headless scenario
groups passed with no browser page errors. Server type checking and both builds
passed. The repository-wide lint/typecheck gates still have inherited failures
(existing `any` declarations/style and `Player.tsx` dynamic component typing);
these are separate from the table feature's checks. Keep their output visible
when preparing a release.

The closing review also verifies entry when browser storage still contains a
singer but the authentication cookie is missing: the QR shows the name/login
form without depending on a socket connection. Transient server/network errors
keep the current identity, and delayed account responses cannot overwrite a
newer login or table transfer.
