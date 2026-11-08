# Player display — implementation and acceptance evidence

Implemented in worktree `KaraokeEternal-display`, branch `feature/player-display-settings`,
based on `84f20672`. The approved plan and complete checklist are stored in Engram
observation **25583**, topic `player-display/approved-plan-checklist`.

## Delivery

- Admin entry: **Ajustes → Pantalla**, `/admin/settings/display`.
- One venue-wide `prefs.playerDisplay`, independent of brand identity.
- FHD (1920 × 1080) reference, proportional HD/FHD/4K layout and a faithful scaled preview.
- Configurable logo, message placement, sizing, colors, transparency, border, corners,
  shadow, text, icon and message interval. Existing visibility exclusions are preserved.
- Normal UI saves persist and broadcast to connected players. No manual database editing
  is required to operate the feature.

## Evidence sources

| Reference | Evidence |
| --- | --- |
| Contract | `shared/playerDisplay.test.ts`: defaults, bounds, finite values, colors, messages, appearance reset |
| Persistence | `server/Prefs/brandingRouter.test.ts`: admin authorization, persistence, public reads, independent identity reset, invalid/failing writes and broadcasts |
| Socket | `server/Prefs/socket.test.ts`: rejects generic socket writes to `playerDisplay` |
| Migration | `server/Prefs/playerDisplayMigration.test.ts`: legacy identity/settings, existing-value priority, repeated migration, downgrade/upgrade |
| Geometry | `src/components/PlayerDisplay/layout.test.ts`: HD/FHD/4K ratios, extreme offsets and turn-card placement |
| Routing | `server/lib/clientAssets.test.ts`: direct/reloaded display route under the configured base path |
| Browser | `config/player-branding.e2e.mjs` and `config/player-display-checks.e2e.mjs`: actual UI, two room players, playback and screenshots |
| Lifecycle | Existing Player lifecycle and YouTubePlayer focused tests |

## Checklist results

### Navigation and ownership

- [x] **N1** Dedicated Pantalla navigation and route; direct URL and reload work. Routing + Browser.
- [x] **N2** Page identifies the venue-wide scope and FHD reference. Browser + visual inspection.
- [x] **N3** Marca del local contains identity controls only. Browser checks display controls absent.
- [x] **N4** Screen references the existing logo and links to its identity editor; no second uploader. Source + Browser.
- [x] **N5** Saving/resetting brand identity preserves screen settings. Persistence + Browser.

### Visual capabilities

- [x] **V1** Logo enable, size, corner, margins and opacity are editable. Contract + Browser.
- [x] **V2** Logo uses `object-fit: contain` and retains its image ratio. Source + screenshots.
- [x] **V3** Announcement width, anchor, horizontal offset, vertical margin and padding are editable. Geometry + Browser.
- [x] **V4** Text size, alignment and automatic/custom color are editable. Contract + Browser.
- [x] **V5** QR icon can be hidden/shown. Browser.
- [x] **V6** Background color and opacity are editable. Browser.
- [x] **V7** Border width and color are editable. Contract + Browser.
- [x] **V8** Corner rounding and shadow are editable. Contract + Browser.
- [x] **V9** Geometry is bounded to the player; oversized message content fits the available height. Geometry extremes + Browser long-message scenario.
- [x] **V10** Up to five title/body messages and a configurable interval. Contract + Browser add/remove/limit checks.
- [x] **V11** Rotation pauses with playback. Browser waits beyond the configured interval while paused.

### Preview and usability

- [x] **U1** FHD is the initial logical reference and preview selection. Browser.
- [x] **U2** Preview renders at the selected logical dimensions, then scales the whole canvas. Browser compares normalized preview/player bounds.
- [x] **U3** HD/FHD/4K maintain consistent relative sizes; 4K does not retain the old fixed cap. Geometry + Browser.
- [x] **U4** Mobile editor fits a 390px viewport without horizontal overflow. Browser + screenshots.
- [x] **U5** Tested foreground/background combinations are readable on light/dark scenes; automatic foreground switches for light backgrounds. Browser + screenshots.
- [x] **U6** Messages share a grid footprint and remain stable while rotating. Browser compares panel heights before/after rotation.
- [x] **U7** Checkboxes, selects, fields and recovery controls work by keyboard, with visible focus. Browser + screenshot review.
- [x] **U8** Reduced motion removes overlay animation and message transitions. Browser media emulation.
- [x] **U9** Controls use short Spanish labels, grouped detail controls and essential status/error feedback. Visual/source review against karaoke-ui.
- [x] **U10** Invalid values focus the relevant field; failed saves retain the draft and previous applied settings. Browser validation and injected HTTP failure.

### Playback

- [x] **P1** YouTube LISTEN uses independent logo/message enable settings. Browser toggles both combinations.
- [x] **P2** YouTube SING and UNKNOWN show only an enabled logo. Browser.
- [x] **P3** Preparation and transition scenes, including handoff/exit, contain no new overlay. Browser mutation observation + controller gate review.
- [x] **P4** Idle/error/local stages exclude the new overlay. Browser startup, failure and LOCAL successor scenario + controller review.
- [x] **P5** Applying display settings preserves media dimensions and position. Browser bounding-box assertions.
- [x] **P6** Applying settings retains the media DOM node and playback. Browser identity/playback checks + Lifecycle.
- [x] **P7** Fullscreen entry and exit work with the overlay. Browser Ctrl+Alt+K and fullscreen API.
- [x] **P8** Autoplay recovery remains keyboard-accessible and visually above announcements. Browser injection, screenshot and recovery action.
- [x] **P9** Existing table-QR invitation is not duplicated during YouTube songs. Browser with REQUIRED_QR enabled.
- [x] **P10** Turn cards avoid the occupied announcement band and logo corner. Geometry combinations + Browser bounding-box separation.

### Persistence and verification

- [x] **D1** Migration retains legacy logo reference, enabled switches, centered brown appearance and invitation. Migration fixture matching the existing settings.
- [x] **D2** Reinitialization does not overwrite a newer display configuration. Migration.
- [x] **D3** Writes require administrator authorization. Persistence + Socket.
- [x] **D4** Invalid/failing saves do not persist or broadcast. Persistence + Browser.
- [x] **D5** Applied settings reach active players in two different rooms without reload. Browser.
- [x] **D6** Offline/reconnected player receives the latest setting. Browser.
- [x] **D7** Discard and appearance reset preserve their defined scope, including identity/messages/activation. Contract + Browser.
- [x] **D8** Focused tests, TypeScript, changed-file lint and whitespace checks pass. Commands below.
- [x] **D9** HD/FHD/4K/mobile screenshots were inspected, alongside editor and recovery screenshots.
- [x] **D10** HTTPS-origin validation includes real YouTube playback. Exact isolation scope below.

## Checks executed

```sh
npm test -- shared/playerDisplay.test.ts src/components/PlayerDisplay/layout.test.ts server/Prefs server/lib/clientAssets.test.ts src/routes/Player/components/Player/Player.lifecycle.test.tsx src/routes/Player/components/Player/YouTubePlayer/YouTubePlayer.test.tsx
npm run typecheck
# ESLint was run on all changed JS/TS files and the new PlayerDisplay directory.
git diff --check
KARAOKE_E2E_MODE=development node config/player-branding.e2e.mjs
npm run build:server
npm run build:client
node config/player-branding.e2e.mjs
KARAOKE_E2E_MODE=development KARAOKE_E2E_HTTPS_UI=1 KARAOKE_E2E_WORKTREE_UI=1 KARAOKE_E2E_REAL_YOUTUBE=1 node config/player-branding.e2e.mjs
```

- **123 focused tests / 11 files passed.** Migration tests also passed after assigning
  migration number 036 to avoid the parallel 034/035 migrations in the main checkout.
- Development StrictMode, production, and HTTPS real-YouTube browser runs passed.
- Production builds succeeded with eight license-plugin/bundle-size warnings.
- Final production artifacts: `/tmp/opencode/player-display-pITwUs`.
- HTTPS real-YouTube artifacts: `/tmp/opencode/player-display-2F4ldc`.
- Development long-content artifacts: `/tmp/opencode/player-display-Yqcx4z`.
- The last CSS-only change gave recovery notices stacking priority; it was rechecked
  in the final production browser run and its `autoplay-recovery.png` was inspected.

## Scope and integration notes

- The HTTPS run first verifies the real tunnel is reachable. The browser uses
  `https://karaoke.puyu.pe/`, with **unmerged worktree assets and isolated API/socket
  traffic supplied through Playwright routing**. YouTube itself is real network playback.
  This proves the worktree flow in the secure origin, not deployment of these assets
  to the shared server.
- Screen dimensions are CSS viewport sizes. Testing actual TV hardware/overscan is an
  operator calibration step, not a claim made by these browser checks. Custom colors
  remain operator choices; the readability checks cover the tested combinations.
- The main checkout and its active database were not modified. Its parallel birthday
  work touches some of the same navigation/player files and needs normal integration
  review. Display uses migration **036**, leaving 034/035 to that work.
- Dependencies are reused through an ignored `node_modules` link. CodeGraph reported
  this worktree unindexed; scoped file reads were used instead of copying another index.
- Verification was completed in the isolated worktree before integration. Git history
  records the subsequent commit and integration status.
