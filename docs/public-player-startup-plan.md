# Public player startup: one Play action

**Target:** on a fresh `/player` tab, the audience sees the room and only two local actions: **Reproducir** when a local start or recovery is needed, and **Pantalla completa** when supported. The room operator retains remote controls. Once started, the existing turn director handles playback automatically.

## Responsibilities

- `PlayerView` / `PlayerController`: own the public startup surface inside the fullscreen container. Derive its state from room authority, the current play intent and actual media events. Do not introduce a second queue, turn director or persisted “audio unlocked” flag.
- `PlaybackCtrl`: retain the operator toolbar on management routes. On the public route, avoid mounting its transport, volume, display settings, animator link and cancel action. Keep the visible presentation layers (lyrics, scene, birthday, QR and logos).
- `Player`, native media adapters, `YouTubePlayer` and `useAnimationPlayer`: expose narrowly scoped activation or retry for the current media. Only the active iframe can retry. Preview components retain their own controls.

## Delivery sequence

| Stage | Deliverable | Acceptance gate |
| --- | --- | --- |
| 1. Establish a cold-start baseline | Add an isolated fresh-context scenario for `/player`. Capture visible actions, room authority, Play requests, queue/replay identity and the first actual `PLAYING`. Exercise local media and a YouTube fixture with autoplay blocked. | Distinguish a click, a server command and actual playback. Reproduce the unwanted public animator controls; do not assume the reported audio notice proves a device failure. |
| 2. Centralize local start and recovery | Implement one local Play handler. Check authority, invoke eligible audio activation synchronously during the trusted click or keyboard event, then send at most one Play request. If a command is already pending, satisfy the gesture without sending another. If an active medium was blocked, retry that medium for the current turn instead. | Double click, repeated Enter or a remote Play arriving first cannot start two turns. A late acknowledgement from a cancelled or superseded turn cannot restart playback. A slow optional catalog download cannot hold the Play button indefinitely. |
| 3. Switch the public controls together | Mount the minimal public surface and connect it to the handler from stage 2. Replace separate public sound-permission, audio retry and YouTube retry buttons with the same **Reproducir** action. Keep the existing fullscreen helper and keyboard shortcut independent of playback. | A fresh tab has one accessible Play action, usable by mouse, touch or keyboard. Fullscreen works before or during playback and never requests Play. Leaving fullscreen does not pause or replay. Controls remain reachable inside fullscreen. |
| 4. Separate blocking conditions from diagnostics | During authority negotiation show a brief connecting status. If another player owns the room, show that fact without an actionable Play. A confirmed autoplay block exposes Play again. A failed optional greeting/bed/clip goes to diagnostics; a real failure of the current song uses its existing recovery policy. Gate local technical tools with development **and** `DEV_PLAYER_TOOLS=true`. | No generic sound error on first render or from an optional clip failure. A denied player emits no playback command. Admin pause/next/stop/volume and announcement cancellation still work remotely. The public display still shows ordinary choreography. |
| 5. Validate the first session | Run the focused browser matrix below with Node 24.22.2, then check a new tab on the development HTTPS player with the room display and speakers. Update existing tests that intentionally operate the full toolbar to act from the operator page or explicit development tools. | Cold start and recovery pass before retiring the old public entry points. Record browser, source, actual start, audible output and whether a second trusted gesture was required. |

## First-session acceptance matrix

**Stage 1 baseline:** run each source in its own temporary room and fresh Chromium context with Node 24.22.2:

```sh
KARAOKE_E2E_MODE=development KARAOKE_E2E_COLD_SOURCE=local mise exec node@24.22.2 -- node config/transition-player.e2e.mjs
KARAOKE_E2E_MODE=development KARAOKE_E2E_COLD_SOURCE=youtube mise exec node@24.22.2 -- node config/transition-player.e2e.mjs
```

The printed `cold-start-<source>.json` records visible controls, the first screen click, socket request and command, audio context resume attempts and the queue ID of the first media play event. The isolated YouTube adapter deliberately blocks its first playback attempt. Current behavior exposes two Play buttons, the animator link and an announcement cancel action. Recovery uses a third label, **Reproducir aquí**, without sending a second room Play request. These characterization assertions are intended to change when the public UI changes. Audio context state is not a speaker-level signal measurement.

| Situation | Expected public behavior |
| --- | --- |
| Cold tab, local song ready | One Play starts the room. Confirm real media playback and sound; do not treat `requestPlay()` as success. |
| Cold tab, YouTube requests another gesture | Show the same Play control. Retry the active iframe synchronously without changing queue item or repeating the announcement. |
| Remote Play before local activation | Remain at the local start screen even if autoplay is permitted. Only local Play mounts the runtime. Once started, remote transport works normally. |
| Empty queue, then first approval | Wait quietly, with no audio error. If the session was started, the newly eligible song proceeds under normal queue rules; do not bypass manual karaoke authorization. |
| Active announcement or optional asset unavailable | The public screen shows the scene, not **Animador** or **Detener anuncio**. Continue according to the recipe's existing fallback. |
| Duplicate player, disconnect, remount or late callback | Only the current authorized player may start. Reconnecting does not replay an old intent. |
| Development tools off/on; operator window open | Public controls stay minimal with tools off, including in development. Explicit tools and remote administration still expose their respective controls. |

## Stage 5 verification

Use the stage 1 command with `KARAOKE_E2E_COLD_SOURCE` set to `local`, `youtube`, `empty` or `remote`. Each run creates a temporary room, records the Chromium version, queue item, actual media start and local/remote Play counts, and writes its own JSON report. All four cases passed with Node 24.22.2. `empty` starts with no songs and adds the first approved local track after Play. `remote` restarts the isolated server, waits for renewed player authority, then sends Play from administration before any local click. The blocked YouTube fixture requires one recovery click and zero local room Play requests.

Fresh documents now acquire room authority and wait for room metadata and the initial queue before offering Play. The remote scenario also changes the queue and waits 60 seconds without local activation: no media mount, clip fetch, audio resume or song start is allowed. Only the trusted local gesture mounts the media runtime. The development HTTPS player remained at its two controls after 118 seconds without a local Play, iframe or catalog asset request.
