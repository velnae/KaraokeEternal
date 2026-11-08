# Custom screen logo — PNG, GIF and timed alternation

Implemented in `KaraokeEternal-logo`, branch `feature/player-logo-media`, based on
`3c00a93a`. Screen images are independent from venue identity; existing configurations
continue using the venue logo by default.

## Behavior

- Pantalla → Logo can use **Marca del local** or **Personalizada**.
- Custom mode accepts a static PNG, an animated GIF, or both.
- Static, animated and intermittent presentation modes share the existing geometry.
- Intermittent defaults: 60 seconds static, 6 seconds animated; both are configurable.
- Animation is intentionally independent of request intent: **SING and LISTEN both
  animate when the logo is eligible to appear**.
- Pause and reduced-motion preference use the uploaded PNG or generated GIF poster.
- GIF failures fall back to a still image. Images and timers disappear with the existing
  transition/idle/error visibility rules.
- Upload prepares a draft resource; Apply publishes it. Appearance reset retains source,
  resource references, mode and timings. Discard releases unpublished uploads.

## Storage and validation

- Migration `037-player-logo-images.sql` stores image metadata. File bytes live under
  the configured data directory's `player-logo-images` folder, not in prefs/socket payloads.
- Admin-only multipart upload validates content signatures before bounded FFmpeg decoding.
- PNG: up to 5 MiB and 2048 × 2048; normalized static RGBA PNG.
- GIF: up to 8 MiB, 1024 × 1024, 300 frames, 30 seconds, and a 64 MiB decoded-frame budget.
  The original animation bytes are retained and a static PNG poster is generated.
- Reference validation and preference writes are transactional. Active references cannot
  be deleted. Replaced resources and abandoned drafts have a 24-hour cleanup grace period.
- One image preparation runs at a time; aborted uploads and failed preparations clean staging.

## Verification

- [x] Existing brand source remains compatible; PNG/GIF references and modes validate.
- [x] Real PNG and GIF upload, decode, persistence and poster generation.
- [x] Unauthorized uploads are rejected before creating resources.
- [x] Invalid signatures, wrong slot types, missing references, oversized and complex GIFs fail.
- [x] Storage/preparation failures return actionable errors, publish no resource and release the slot.
- [x] Active deletion is rejected; expired drafts are cleaned; replacement preserves a grace period.
- [x] Upload does not activate until Apply; brand identity remains unchanged.
- [x] Custom image renders even when the brand logo is empty.
- [x] Actual painted GIF frames change in Chromium; a fresh animation window starts at frame one.
- [x] Successive animation windows use fresh local Blob URLs without repeated GIF HTTP downloads.
- [x] Pause and reduced motion stop animation and retain the PNG/poster.
- [x] GIF animates during karaoke, while the announcement remains hidden there.
- [x] GIF-only mode uses its generated poster as a still fallback.
- [x] HTTP GIF failure preserves a still image and ongoing video playback.
- [x] Reload, appearance reset, discard and switching back to venue logo work.
- [x] Mobile/desktop upload controls and preview screenshots inspected.
- [x] Existing display/playback regression passes in development and production.
- [x] Real YouTube and GIF playback checked in the HTTPS browser origin.

## Executed checks and artifacts

```sh
npm test -- shared/playerDisplay.test.ts server/PlayerLogo/PlayerLogo.test.ts server/Prefs
npm run typecheck
# ESLint on all changed JS/TS, and git diff --check
KARAOKE_E2E_MODE=development KARAOKE_E2E_LOGO_ONLY=1 node config/player-branding.e2e.mjs
npm run build:server
npm run build:client
KARAOKE_E2E_LOGO=1 node config/player-branding.e2e.mjs
KARAOKE_E2E_MODE=development KARAOKE_E2E_HTTPS_UI=1 KARAOKE_E2E_WORKTREE_UI=1 KARAOKE_E2E_REAL_YOUTUBE=1 KARAOKE_E2E_LOGO_ONLY=1 node config/player-branding.e2e.mjs
```

86 focused tests pass; typecheck, changed-file lint and whitespace checks pass.
Production builds pass with eight existing license/bundle-size warnings.

- Development focused logo run: `/tmp/opencode/player-display-saZRwG`.
- Production complete display + logo run: `/tmp/opencode/player-display-m93Azh`.
- HTTPS real YouTube + real GIF run: `/tmp/opencode/player-display-XhmRm8`.
- Final storage-error localization was additionally covered by the focused HTTP test and
  server rebuild after the browser runs.

The GIF test samples painted screenshot pixels (red/blue frames), not a canvas snapshot
that could represent only a static frame. It samples shortly after insertion so polling
latency does not mistake a later frame for a failed restart. The existing video fixture now
distinguishes source-reset AbortError from genuine NotAllowedError/autoplay blocking.

HTTPS testing uses the actual reachable origin with isolated worktree assets/API/socket.
Chromium interception omitted multipart file bytes; the proxy reconstructs only the known
PNG/GIF fixtures. Native browser multipart uploads are tested directly in local development
and production. This is not a deployment or an assertion about shared-server multipart traffic.

Verification was completed in an isolated worktree, without modifying venue files or
configuration. Git history records the subsequent integration into develop. Customer-supplied
artwork can be selected through the normal admin UI after integration.

## Integration verification

The combined birthday and custom-logo code passed 267 focused tests across 21 files,
TypeScript, scoped ESLint, and server/client production builds. FFmpeg-heavy tests were
run with `--maxWorkers=2` after an initial parallel-load timeout, without increasing test
timeouts. The display regression now selects the active `aria-hidden="false"` message,
avoiding ambiguity while both messages are painted during their crossfade.

Both HTTPS integration flows passed against the shared frontend with isolated API/socket
data: birthdays (`/tmp/birthday-e2e-LTHHkx`) and display plus real GIF/YouTube playback
(`/tmp/opencode/player-display-pqwN8n`). Production builds retain the eight license/bundle
warnings described above.
