# Player startup, fullscreen and efficiency

The player keeps the existing locally initiated Play workflow and the content
configured by the administrator: queue, announcements, greetings, QR and transition
presentation. These changes optimize the player without adding a new startup flow.

## Fullscreen shortcut

1. Open the player tab and use its existing Play control when ready.
2. Press **Ctrl+Alt+K** to enter fullscreen for the **entire karaoke player**.
3. Use the browser's Escape action to exit fullscreen.

The shortcut targets `#player-fs-container`, not YouTube's iframe or the whole
document. It also works before playback without starting music. The existing
fullscreen button remains available and advertises the shortcut in its tooltip
and `aria-keyshortcuts` attribute.

It is active only on the player route and ignores text fields, open dialogs,
composition, AltGr, handled events and repeated keydowns. It does not replace
YouTube's `F` or `K` keys, Chrome's `F11`, or ordinary Ctrl+K.

Keyboard events inside a cross-origin YouTube iframe stay in that frame. If
YouTube has keyboard focus, focus a karaoke control before using the shortcut,
or use the existing fullscreen button. The application does not take focus away
from YouTube or override custom system/extension shortcuts.

## YouTube controls

The room player explicitly requests `controls=0`. Native YouTube interaction stays
enabled, and the existing application recovery action remains available if the
browser blocks playback. That recovery is separate from the controls parameter.
The shared YouTube component's default and customer-preview behavior are preserved.

This parameter is not a promise to remove YouTube branding or graphics encoded in
the video. The player does not crop or mask the video.

## Internal optimizations

| Area | Behavior |
| --- | --- |
| Track presentation | Memoize by queue, current track, history, locked participant, preferences and loading phase. Position updates reuse the same projection. |
| Media component | Stable callbacks and `PureComponent` avoid rendering unchanged media props. |
| Animation clock | The 250 ms interface clock sleeps during ordinary music playback. Idle work, pending interventions, ambience renewal and reservation expiry retain it. |
| Readiness messages | Coalesce identical in-flight messages and reuse successful acknowledgments. Ownership, audio availability and changed asset sets invalidate them; failures remain retryable. |
| Visualizer catalog | Read the dependency's lightweight preset index during player startup. Full preset definitions remain with the lazy visualizer. All preset choices and their ordering are retained. |

Greeting preparation polling remains intact because profile changes do not yet
provide a sufficient invalidation notification. The optimization removes redundant
readiness publication rather than delaying detection of changed greetings.
Iframe lifecycle, audio limits, leases and playback ordering retain their existing
contracts.

## Verification

Focused coverage checks:

- Fullscreen target, modifier matching, editing guards and request failures.
- Identical projection across 100 position-only updates, with invalidation after
  a real queue change.
- Clock eligibility during music, idle work, ambience and expired/active fences.
- Readiness deduplication, retries and obsolete/out-of-order acknowledgments.
- Complete preset catalog parity and Next/Previous ordering, including JavaScript
  numeric-key ordering.
- Existing local-audio and YouTube lifecycle regressions.

`npm run test:player:compatibility` additionally exercises the shortcut before
and during playback, confirms the fullscreen element is the karaoke `DIV`, checks
`controls=0` with keyboard recovery, and observes no 250 ms clock ticks during more
than 22 seconds of ordinary native playback through the YouTube API fixture.

Run relevant browser checks with `KARAOKE_E2E_MODE=development` and `production`.
`KARAOKE_E2E_HTTPS_UI=1` uses the real HTTPS frontend with isolated API/socket data.
Use `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium` when the bundled browser is
unavailable. Reuse current server builds and build the client target when needed.

The fixture checks do not measure total CPU/GPU savings or prove an overnight soak.
The Chrome 109 build target is retained; runtime results should identify the actual
browser version used.

### Delivery verification — 2026-11-05

- 57 focused tests passed across fullscreen, efficiency, presentation, preset
  parity and existing media lifecycles. Typecheck and changed-file ESLint passed.
- Client production build passed with existing license/bundle-size warnings.
- Player compatibility, transition playback and greeting playback passed in both
  development StrictMode and production on Chromium 151.0.7922.173.
- HTTPS player compatibility passed using the real frontend and isolated API/socket
  fixtures, including the fullscreen shortcut and initial local Play requirement.
- The browser probe observed no 250 ms clock ticks during more than 22 seconds of
  normal playback. The projection test reused one computation for 100 position
  updates. The complete 470-option filtered preset order was preserved.

Evidence directories:

| Scenario | Artifacts |
| --- | --- |
| Player, development | `/tmp/opencode/player-compatibility-VdHLpw` |
| Player, production | `/tmp/opencode/player-compatibility-xQLX5s` |
| Player, HTTPS | `/tmp/opencode/player-compatibility-BoN643` |
| Transitions, development | `/tmp/opencode/transition-player-vECymt` |
| Transitions, production | `/tmp/opencode/transition-player-mBjivx` |
| Greetings, development | `/tmp/opencode/g-audio-e2e-BZj8vM` |
| Greetings, production | `/tmp/opencode/g-audio-e2e-WbYQ1v` |
