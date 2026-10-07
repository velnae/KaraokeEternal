# Administration and player: stage UI

**Goal**: Extend the installed `frontend-design` skill's stage/setlist presentation to the operator and room player, preserving minimal copy and current playback/queue behavior.

**Baseline**: User-selected `develop`, with the previous mobile feature and skill installation still uncommitted. Preserve all of that work. Use `.opencode/skills/frontend-design/SKILL.md`; the six-token palette and Beon/native UI typography are defined in the preceding `mobile-youtube-requests.md` T6.

## Design plan and critique

Operators need to see the active room, moderate requests and reach room/user/settings controls quickly. The public player needs a quiet stage with readable waiting/error/next states; the video and lyrics are the main content.

- Promote the scoped participant palette to a shared karaoke theme, keeping the same Stage `#030509`, Equipment `#111a28`, Lyrics `#f4f7ff`, Secondary `#a6b2c7`, Cyan `#76e0ec`, Amber `#edc47c` values.
- Administration: compact room/transport toolbar, labeled navigation, section shortcuts, readable responsive tables and consistent editors. Make queue secondary actions discoverable with an explicit button; flexible-height items must retain their moderation controls.
- Player: restrained idle/start/error panels, a smaller temporary singer banner, readable QR frame, practical play/next/volume/fullscreen controls. No explanatory walls, continuous glow pulses or persistent cover over the video.
- Shared panels/buttons/modals should use the same spacing, borders, contrast and focus. Modal content must scroll on small screens without hiding save/close controls.

```text
Operator: [room / playback state] [play next] [volume] [display]
          [Administration] [Rooms | Users | Settings | Account]
          [readable rows, status and actions]
          [Library] [Queue] [Admin]

Player:   [back] [room / playback state] [play next volume fullscreen]
          [video fills remaining area]
          [temporary singer banner]              [QR when enabled]
```

Critique: another colorful dashboard with repeated cards would add noise. Use tables for management, clear queue items for moderation, and a single quiet stage state. Keep scheduling, authorization, request receipts and media-provider logic intact.

## Work units

- [x] **A1 — Shared/admin shell**: shared theme, panels/editors, administration section navigation and responsive room/user controls.
- [x] **A2 — Queue and transport**: discoverable queue actions, unclipped rows, compact control bar, clear start-player action and consistent library search.
- [x] **A3 — Player stage**: idle/start/error states, transient singer identity, QR frame, sizing/fullscreen and reduced-motion-safe overlays.
- [x] **A4 — Verification**: isolated synthetic admin/guest/player browser; desktop/mobile/landscape; edit/save, moderation, controls, media clicks, fullscreen, reduced motion; scoped lint/build and relevant behavior regressions.

## Implementation constraints

Use existing React/CSS modules and components, no dependency or new backend feature. The user subsequently authorized local commits; no push or PR is part of the delivery. Tests mutate only the isolated preview database, never the habitual port 3000 data.

Layout-related correctness points found during inspection: fixed queue height and hardcoded scroll offset; hidden buttons still focusable; start-player link unnecessarily gated by fullscreen support; dialog/QR/queue transitions depend on animation completion and must remain usable under reduced motion. Address only what the visual changes require.

Rollback by work unit: shared theme/imports and common surfaces; queue/toolbar styling and action affordances; player overlay/layout components. Preserve server scheduling/authority and the previously implemented YouTube lifecycle fixes.

## Evidence

Implementation and scoped verification completed on 2026-10-06. Local commit delivery on `develop`, including the earlier mobile work, was authorized in a follow-up request.

### Implementation map

- **Shared surfaces**: `participantTheme.css` promoted to `src/styles/karaokeTheme.css` and applied in CoreLayout. Existing participant/sign-in/navigation imports updated. Shared buttons, panels and named native dialogs now use the same palette, focus, spacing and scrolling. Dialog visibility is independent of animation.
- **Administration**: SignedInView adds section anchors; room/user names are real keyboard-operable buttons; filters have accessible names; status badges and responsive tables prioritize name/role/state. AccountView dimensions use CSS viewport sizing to avoid transient overflow during resize.
- **Queue**: flexible card height, complete wrapping title/metadata, explicit More actions, labeled approval/rejection, collapsed actions excluded from focus. Initial scroll locates the actual current item. Reduced-motion exits complete without an animation event; progress is a quiet bottom line.
- **Transport/library**: room/state context, primary play/pause, next, volume with percentage, screen/fullscreen tools; two-row mobile arrangement. Launching the player no longer requires fullscreen support. Library empty state does not cover search; empty local-result headings are suppressed. Shared artwork moved to `src/components/SongArtwork/` for participant and operator use.
- **Stage**: concise idle/start/error panels, explicit recovery actions, non-intercepting overlay, small temporary singer banner. Video uses the full remaining height, with no subtraction for the absent navigation footer; fullscreen changes trigger a re-render. QR has a white frame, medium error correction and no obstructing center logo; timeout-driven transitions work under reduced motion.

### Checks

- Final `npm test -- --reporter=dot`: **202/202 passed in 27 files**.
- `npx eslint src`: passed across the frontend. `git diff --check`: passed.
- Typecheck retains the pre-existing `src/routes/Player/components/Player/Player.tsx:173` TS2604; no player implementation change was made to that baseline issue. Global lint's historical 29 unrelated server/config findings remain outside this UI task.
- Isolated production build: `npm run build:client -- --output-path /tmp/opencode/karaoke-admin-stage-build` passed; final suffix `b4501f395390b9a69b3d`, same eight license/size warnings and Browserslist notice.

### Browser evidence

Preview runner `/tmp/opencode/karaoke-admin-preview.mts` used a new synthetic SQLite directory and port **43188**. YouTube API and IFrame playback were simulated. `/tmp/opencode/karaoke-admin-error-fixture.mts` created one deliberately missing local MP4 in a separate synthetic room to exercise the actual browser media-error path. Habitual port 3000 was not used for test mutations.

| Scenario | Observed result |
| --- | --- |
| Admin desktop/mobile | No horizontal overflow at 320/390/1440px; room/user controls and section navigation remained accessible. |
| Room editor under reduced motion | Visible (`opacity:1`), 820px dialog in 844px viewport, no internal horizontal overflow; expanded queue settings and saved successfully. |
| Pending moderation | Hidden removal controls absent from accessibility tree; More actions revealed them; approval updated the guest and removed the pending card without a motion-related ghost. |
| Library search | YouTube results visible without the local-library overlay or zero-count local headings; empty favorites rendered one empty state. |
| Player start without fullscreen support | Launch link remained visible when `document.fullscreenEnabled` was false. |
| Idle/ready/play/pause/next | All states and actions exercised through UI with synthetic IFrame. Overlay did not intercept a click on the video surface. |
| Volume | Keyboard adjustment updated the displayed value from 100% to 99%. |
| Fullscreen | Player element height matched the 800px fullscreen viewport; exit restored the layout. |
| Responsive player | Video heights: 720px at 320×844 and 390×844; 322px at 844×390; 832px at 1440×900. No horizontal overflow; toolbar buttons at least 44×44px. |
| QR reduced-motion transition | Advancing to the next song with accelerated client clock caused the QR to alternate sides and return to opacity 1 despite disabled CSS transitions. |
| Second player | Correct active-player notice; existing authority behavior preserved. |
| Real local media error | Missing fixture MP4 produced the new error panel; View queue remained accessible and Next recovered to the empty state. |

No page exceptions occurred in these flows. Expected missing-avatar/media 404s belong to synthetic fixtures. Actual YouTube audio/video and physical-device QR scanning are not claimed by this visual test.

### Screenshot critique and artifacts

The first screenshots exposed stale JS-sized AccountView width during resize; CSS sizing corrected it. The initial mobile toolbar used three rows, so it was reduced to two. A background and border were added to distinguish the volume handle from its track. Legacy blue/red search headings and redundant zero-result labels were removed on the final pass.

Ignored screenshots in `.playwright-mcp/`: `operator-desktop.png`, `operator-mobile.png`, `operator-queue-mobile.png`, `operator-library-final.png`, `player-idle.png`, `player-ready.png`, `player-mobile-final.png`, `player-playing-desktop-final.png`, `player-error.png`, `player-authority-final.png`. Earlier captures may show the pre-critique three-row toolbar; `*-final` captures use the final transport layout.

Temporary preview processes are stopped after verification. Reload the habitual development app to inspect the changes; all operational accounts/configuration remain managed through the existing application.

Commit preparation revalidated the integrated candidate after the small receipt-storage correction documented in `mobile-youtube-requests.md`: **203 tests passed**, frontend ESLint and diff checks passed; client build suffix `26f7f9a9a9e720cd7956` with the same eight existing warnings. Earlier browser evidence above remains scoped to the presentation work.
