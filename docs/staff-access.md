# Staff access for a dedicated installation

Keep technical administrator accounts with the implementation team. Create client
accounts from **Usuarios → Crear usuario**, choosing **Operador** or
**Encargado del local**. Accounts already installed retain their roles.

| Role | Access |
| --- | --- |
| `admin` | Full administration, user assignment, catalogs and provider configuration. |
| `operator` | Playback, request moderation, queue maintenance, prepared playlists and announcements. |
| `manager` | Operator access plus the limited Personalización page. |
| `standard`, `guest` | Participant requests and the existing table/QR rules. |
| `player` | Reserved legacy role; does not grant staff access and cannot be assigned in user management. |

Managers can edit the venue name and brand logo; logo visibility, position, scale
and opacity; and choose a ready, active background in their current room. Support
links, advanced display settings, uploads/deletions of catalog resources, provider
generation, user management, and room/table structure remain administrator-only.
Branding and display settings apply to the whole installation. This is not a
tenant boundary.

## Implementation boundaries

- `shared/permissions.ts` defines fixed permissions used by the server and UI.
- Migration `040-staff-roles.sql` adds roles without renumbering existing ones.
  Version 039 is reserved for concurrent birthday work in the main checkout.
- Tokens identify accounts; HTTP requests and socket actions reload current roles
  from the database. Role changes disconnect affected sockets and release player
  authority through the normal lifecycle. Old cookies cannot restore privileges.
- Restricted preference writes whitelist fields, merge with current settings and
  reuse existing validation. Background selection retains revision checks.
- Staff receive playback preferences, not filesystem paths or provider settings.
  Only their current room exposes the operational QR/background preferences.

## Acceptance checklist

Verified through focused tests and `config/staff-access.e2e.mjs`:

- [x] Operator and manager can acquire player authority; another player is rejected.
- [x] Both profiles play and pause browser media; volume accepts keyboard control.
- [x] Staff can approve and move participant requests and use prepared house lists.
- [x] Staff can request/cancel prepared announcements before audio is unlocked.
- [x] Staff cannot create lists, generate audio, manage users, or modify room structure.
- [x] Manager can change the name, upload a logo, adjust approved logo fields and select a prepared background.
- [x] Protected support/display/background fields remain unchanged; forbidden fields and out-of-range values are rejected.
- [x] Role changes and deletion invalidate old privileges; disconnected pending requests cannot publish.
- [x] Guest QR requests and registered/reserved participant restrictions still work.
- [x] Staff can update their own account and sign out without deleting room songs.
- [x] Administrator retains user management and can assign both new roles.
- [x] Direct restricted URLs redirect; HTTP and socket calls independently reject unauthorized actions.
- [x] Navigation, queue menus and forms hide technical actions; menu/slider keyboard interaction works.
- [x] Mobile (390 px) and desktop (1440 px) screenshots were inspected without horizontal overflow.
- [x] Empty-background guidance and save feedback are visible; failed field validation does not persist changes.

The browser playback fixture uses a local video with real audio through a mocked
YouTube adapter. It does not verify YouTube availability or physical speaker output.

## Repeat the checks

```sh
npm test -- shared/permissions.test.ts server/User server/Queue server/Player server/Prefs server/Rooms server/Tables server/Playlists server/lib/clientAssets.test.ts src/routes/Player/components/Player/Player.lifecycle.test.tsx
npm run typecheck
KARAOKE_E2E_MODE=development npm run test:staff:e2e
npm run build
npm run test:staff:e2e
KARAOKE_E2E_HTTPS_UI=1 npm run test:staff:e2e
```

E2E runs create temporary data, disable provider credentials and use a reserved
local port. The HTTPS variant checks `https://dev-karaoke.puyu.pe/` reachability,
then forwards browser requests on that HTTPS origin to this checkout's isolated
frontend/API and polling sockets. It does not deploy this branch or write to the
shared development database. Logs, screenshots and `checks.json` are printed with
each run's artifact directory.

## Remaining baseline issues

- [ ] Direct local CDG startup in development StrictMode can throw
  `HTMLMediaElement already connected previously to a different MediaElementSourceNode`.
  Reproduced separately with the main checkout's administrator and temporary
  data. The passing browser fixture above does not cover that startup path.
- [ ] The broader regression run has 13 existing failures in
  `server/Greetings/transition.test.ts`, `server/Greetings/migration.test.ts` and
  `server/TransitionVideo/Store.test.ts`. The identical failures were confirmed on
  the main checkout without these staff-access changes: outdated singing-title fixtures, a queue snapshot missing
  `rejectionReason`, and rollback fixtures executing a null down migration.
- [ ] Deployment and acceptance on the client's installed system remain pending.
