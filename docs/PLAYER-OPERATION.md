# Player controls, startup and efficiency

The player keeps the existing locally initiated Play workflow and the content
configured by the administrator: queue, announcements, greetings, QR and transition
presentation. These changes optimize the player without adding a new startup flow.

Use **Chrome 128 or later** for the player. Chrome 109 and the legacy
`webkitAudioContext` fallback are no longer supported.

## Remote fullscreen

The admin's **Pantalla completa del reproductor** icon requests fullscreen for the
active karaoke player in the same room. It appears beside **Abrir reproductor** before
connection, with an explanation while unavailable, and in the admin playback
header once the player connects. It uses the normal toolbar styling, with a tooltip
and accessible name. **Ver pasos** opens browser setup instructions.

1. Configure automatic fullscreen in the browser/profile running the **player**,
   using the platform instructions below.
2. Open the player and give it the initial local **Play**.
3. Detach its tab into a separate window and move it to the desired monitor.
4. From admin, click **Pantalla completa**. Wait for the player's confirmation.
   Escape in the player exits fullscreen.

The action targets `#player-fs-container`, including karaoke overlays. It does not
select a monitor, start/restart music or fullscreen the admin window. Only the
room's authoritative player receives the command. Requests expire after five
seconds; room, connection and ownership changes invalidate stale results.

### Allow automatic fullscreen

Configure the **player's computer and browser**, not the server. Initial Play does
not grant this permission: Chrome normally requires a fresh gesture in the target
window. Remote fullscreen requires `AutomaticFullscreenAllowedForUrls` for that player's
exact origin, normally **`https://karaoke.puyu.pe`** (no trailing slash or path).
If the player uses another origin, use the origin shown after its response.

**Windows — Google Chrome**

For a new list, save the following as `karaoke-fullscreen.reg` and import it under
the Windows account running Chrome. If the policy already has numbered values,
add the origin with the next unused number instead of replacing `1`.

```reg
Windows Registry Editor Version 5.00

[HKEY_CURRENT_USER\Software\Policies\Google\Chrome\AutomaticFullscreenAllowedForUrls]
"1"="https://karaoke.puyu.pe"
```

**Linux — Google Chrome or Chromium**

Save `karaoke-fullscreen.json` in the browser's managed policy directory, creating
the directory if needed with administrator privileges:

| Browser | Directory |
| --- | --- |
| Google Chrome | `/etc/opt/chrome/policies/managed/` |
| Chromium (default) | `/etc/chromium/policies/managed/` |

```json
{
  "AutomaticFullscreenAllowedForUrls": ["https://karaoke.puyu.pe"]
}
```

Keep the file administrator-owned and readable by Chrome. If this policy already
exists, append the origin to its existing list rather than defining it in two
files. Some distribution packages use another directory; consult their packaging
documentation if the policy does not appear.

**Check the configuration**

Open `chrome://policy` in the player's browser, select **Reload policies**, and
confirm `AutomaticFullscreenAllowedForUrls` contains the exact origin with status
**OK**. This policy supports dynamic refresh. A matching
`AutomaticFullscreenBlockedForUrls` entry takes precedence over the allow list.

Retry from admin. A denial displays setup instructions; a missing player or lost
connection displays the next step instead of claiming success. If browser policy
cannot be configured, use the local shortcut below. To revoke the permission,
remove this origin from the policy and reload policies.

References: [Chrome policy](https://chromeenterprise.google/policies/automatic-fullscreen-allowed-for-urls/),
[automatic fullscreen support](https://chromestatus.com/feature/6218822004768768),
[Linux policy locations](https://www.chromium.org/administrators/linux-quick-start/).

## Close the player from admin

1. Select the **Cerrar reproductor** icon beside fullscreen.
2. Confirm **Cerrar y detener**, or select **Cancelar** to keep playback running.
3. The player stops music, voice and ambience through its normal unmount, releases
   the room, and attempts to close its tab. Admin returns to **Sin reproductor**.

The queue is preserved; an interrupted song returns to pending (`APPROVED`). A
new player still requires local Play. The request targets only the authoritative
player in the administrator's room and expires after five seconds. An accepted
command alone is not success: the server waits for that player's actual departure.
The player waits for its `PLAYER_LEAVE` notice before closing the tab, so HTTP
polling does not lose the cleanup message during unload.

Chrome normally allows closing a tab opened by an ordinary click on **Abrir
reproductor**. It can refuse tabs opened manually or with browser modifiers. In
that case, audio is already stopped and a neutral view says **Reproductor cerrado
desde administración**. Close that window manually. The automatic-fullscreen
policy does not override this separate browser restriction.

Reference: [Window.close restrictions](https://developer.mozilla.org/en-US/docs/Web/API/Window/close).

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
- Remote fullscreen permission denial/grant, idempotence, expiry, admin-only
  requests, room isolation and ownership revalidation.
- Remote close acceptance versus departure, lost acknowledgments, timeouts,
  listener cleanup and preservation of the interrupted song.
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
It also opens admin in a separate browser window, lets player activation expire,
denies/grants automatic fullscreen in an isolated browser context, and checks
that remote fullscreen preserves the media element, playback position and queue.
The help dialog is exercised with keyboard navigation and mobile/desktop layouts.
The same suite checks close confirmation/cancellation, Chrome's real refusal to
close a manually opened tab, native closure of a link-opened tab, and local Play
after reopening. `npm run test:greetings:playback` additionally closes the player
while a greeting and its ambience are active and verifies native audio contexts
are closed and the song remains pending.

Run relevant browser checks with `KARAOKE_E2E_MODE=development` and `production`.
`KARAOKE_E2E_HTTPS_UI=1` uses the real HTTPS frontend with isolated API/socket data.
Use `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium` when the bundled browser is
unavailable. Rebuild the server and client targets when their sources change before
running production checks.

The fixture checks do not measure total CPU/GPU savings or prove an overnight soak.
They simulate browser permission with CDP, not an installed OS policy. Validate
policy installation and physical monitor/focus behavior on the player's computer.
The build target is Chrome 128; runtime results should identify the actual browser
version used.

### Stable controls and remote close — 2026-11-06

- 60 focused fullscreen/window-command/socket tests passed. Typecheck,
  changed-file ESLint and diff checks passed.
- Player compatibility passed in development StrictMode, production and HTTPS
  on Chromium 151.0.7922.173. Coverage includes icon-only controls, keyboard
  confirmation/cancellation, actual native close/refusal, preserved queue and a
  new local Play after reopening. Desktop/mobile screenshots were inspected.
- Greeting playback passed in development StrictMode and production, including
  remote close during voice and ambience. The check observes closed native
  AudioContexts: disposing an audio clock can suppress scheduled `ended` events.
- Both build targets passed with the existing eight client license/size warnings.

| Scenario | Artifacts |
| --- | --- |
| Player, development | `/tmp/opencode/player-compatibility-6suC0M` |
| Player, production | `/tmp/opencode/player-compatibility-dMXcHB` |
| Player, HTTPS | `/tmp/opencode/player-compatibility-OxSnsU` |
| Greetings, development | `/tmp/opencode/g-audio-e2e-5reLW4` |
| Greetings, production | `/tmp/opencode/g-audio-e2e-TjefjV` |

### Initial remote fullscreen verification — 2026-11-06

- 63 focused tests passed across fullscreen, socket commands and the music audio
  lifecycle. Typecheck and changed-file ESLint passed.
- Server and client production builds passed. The client retained its eight
  license/bundle-size warnings.
- Separate-window fullscreen passed in development StrictMode, production and
  the HTTPS frontend with isolated API/socket data on Chromium 151.0.7922.173.
  Permission denial displayed guidance; permission grant entered the karaoke
  container with no fresh player activation and no media/queue restart. Repeated
  requests were idempotent. Help worked by keyboard at 1440 px and 390 px widths;
  screenshots were inspected.
- Existing transition and greeting playback suites passed in both development
  StrictMode and production. OS policy installation and physical monitor/focus
  behavior remain the operator's hands-on check.

| Scenario | Artifacts |
| --- | --- |
| Player, development | `/tmp/opencode/player-compatibility-lYJ9sF` |
| Player, production | `/tmp/opencode/player-compatibility-LyUSl7` |
| Player, HTTPS | `/tmp/opencode/player-compatibility-nwGxHc` |
| Transitions, development | `/tmp/opencode/transition-player-t7PxcC` |
| Transitions, production | `/tmp/opencode/transition-player-dSXq0x` |
| Greetings, development | `/tmp/opencode/g-audio-e2e-10ba4r` |
| Greetings, production | `/tmp/opencode/g-audio-e2e-r6kBW8` |

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
