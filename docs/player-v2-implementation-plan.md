# Player V2 implementation plan

**First release target:** one normal song-to-song transition in development, with an audible bed, one authorized announcement and a visible handoff even when a reply is lost. Migrate the other choreographies after this works on the room player. Each turn has exactly one executor.

## Ownership and minimum contracts

| Owner | Implementation starting point | Contract |
| --- | --- | --- |
| Queue and room authority | `getPlaybackQueue`, `playbackSettlement`, server player/animation handlers | Keep the existing order, history, room epoch, finite permits and deduplication. Only the authoritative player can advance. |
| Turn planner | Proposed `src/routes/Player/runtime/turnPlan.ts` | Pure function of queue selection, playback token, room preferences and capabilities. Produce ordered steps, optional resources and completion conditions. A plan is not permission to play. |
| Turn director | Proposed `src/routes/Player/runtime/turnDirector.ts` | Consume events for one turn, issue commands through adapters, and settle once. It owns advancement, cancellation and the handoff deadline. React renders its view state. |
| Media, audio and scene adapters | Existing `Player`, `YouTubePlayer`, `AnnouncementAudio`, `TransitionBackground` | Report observable facts: decoded asset, poster ready, first video frame, audio completion, incoming `PLAYING`, error. Preparing YouTube does not start it. Native media and the iframe retain their respective volume controls. |
| Permission adapter | Existing `animationApi`, `transitionRequest`, greeting/animation receipts | A command is granted, rejected, omitted, or unanswered. Only an explicit pre-execution expiry permits a bounded retry. After an ambiguous write, look up the original grant; check room, owner, epoch, turn and remaining validity. |

Use the current TypeScript, Redux, socket and media implementations. Start with functions and narrow adapter interfaces; add a new server contract only if a required fact cannot be obtained through an existing one.

## Delivery sequence

| Order | Work unit | Acceptance gate |
| --- | --- | --- |
| 1 | **Characterize V1.** Capture the normal-turn decision points in `PlayerController`, `useAnimationPlayer`, `useGreetingPlayer` and `AnnouncementAudio`. Turn the known late grant, black backdrop and evicted bed incidents into reusable fixtures. Record intentional omissions separately from failures. | A fixture identifies the source playback, expected destination, configured layers, actual outcome and reason. Baseline evidence distinguishes available, authorized and rendered resources. |
| 2 | **Extract the normal planner and compare passively.** Adapt the existing queue selector and `playbackToken(queueId, replayKey)`. Attach destination, room and epoch; invalidate the run when these change. Compare the V2 plan with V1 decisions through the existing bounded development trace. | Same queue order and eligibility on natural end, replay, explicit next, newly approved request and empty queue. The comparison performs zero playback, public reservations, rotation or history writes. Explain discrepancies before enabling execution. |
| 3 | **Build the director against fake adapters.** Use an injected monotonic clock and an event reducer returning the next state and commands. Bind every async result to its run; invalidate before releasing resources. Server time fences permissions; the audio clock schedules sources; elapsed local time limits waiting. | Duplicate `ENDED` and late replies cannot advance twice. Pause, stop, skip, remote close, unmount, disconnect and authority loss cancel owned work. A resumed or replacement player cannot replay an uncertain voice. |
| 4 | **Wire the normal turn in development.** Route only eligible normal turns to V2 at the turn boundary. Use existing preparation/cache and mixer code. Select video once, protect the decoded bed until release, and start authorized ambience independently of first frame. Preserve ReplayGain, autoplay recovery, background fallback, volume and reduced motion. | Pass the normal-turn matrix below. Verify supported media paths: YouTube cue-to-play, native MP4, CDG and MP4-alpha where enabled. Confirm on the development player visually and through the room speakers. This is the first usable milestone. |
| 5 | **Migrate listening requests and greetings.** Move the sequencing decisions from `useGreetingPlayer` into a recipe; retain its card-commit, reading-time, attribution and permission rules. | With or without greeting, one presentation per turn. An unavailable voice can yield a readable card. No second generic announcement or bed restart. Removing an active greeting cancels only its owned work. |
| 6 | **Migrate karaoke.** Bring entry, call, reminders, operator release, countdown and ending cue under one run. Keep the karaoke-specific backdrop, bed and manual-start rules. | An operator wait never becomes a timed authorization. A late release after cancellation does nothing. On valid release the correct track starts once, with no bed over the singer. |
| 7 | **Migrate birthdays and idle ambience.** Reuse `birthdayTimeline`, the existing birthday permit/heartbeat and its interruption rules. Give idle ambience an explicit handoff to the next run. | A scheduled birthday owns the permitted boundary; no animator overlaps it. After completion, reselect against the current queue. Idle-to-song, song-to-idle and manual karaoke after birthday all release the previous audio owner. |
| 8 | **Cut over and remove duplication.** Move each migrated hook's sequencing out of the V1 path. Preserve operator controls, fullscreen/remote close, lyrics, QR, logos and visualizer. Remove the temporary executor selector only after room acceptance for all recipes. | One owner for each advance, gain change and scene exit. No orphaned timers, duplicate reservations or V1 listeners still driving V2. A new cue can be added as a recipe step plus a contract test, without changing the other recipes. |

## Normal-turn acceptance matrix

### Stage 1 baseline (V1)

Run `KARAOKE_E2E_MODE=development KARAOKE_E2E_DELAYED_ACKS=1 mise exec node@24.22.2 -- node config/youtube-preparation.e2e.mjs`. The isolated fixture prints the directory containing `v1-turn-1.json` through `v1-turn-4.json`: initial play, resumed handoff, next after replay, and natural end. Queue IDs identify the expected destination even when two requests use the same video. The existing suite injects a lost grant, a lost warmup selection and delayed or missing acknowledgements. For the catalog-pressure case run `mise exec node@24.22.2 -- npm test -- src/routes/Player/components/Animation/AnnouncementAudio.test.ts config/diagnostics/v1-normal-turn.test.js`.

| V1 decision | Independent baseline evidence |
| --- | --- |
| `PlayerController`: recover the same visual selection, then hand off | Selection reply, presented video frame on the visible scene, incoming play command and subsequent media state/fade checks |
| `useGreetingPlayer`: bypass the greeting path for HOUSE tracks | Explicit house-track omission, separately from a missing or rejected grant |
| `useAnimationPlayer`: reserve or recover the turn's voice and bed | Correlated animator grant and server bed reply, including a reply dropped before it reaches the player |
| `AnnouncementAudio`: prepare and actually mix the decoded clips | Decode timestamps, signal measured after gain, bed/voice overlap and curtain completion |

The report describes the isolated fixture, not the venue speakers. A `null` evidence field is unobserved, not a rejection. The reduced incident cases distinguish interrupted speech, an unrendered backdrop and an unavailable bed from an intentional omission. No V2 playback code runs in this stage.

Run with Node 24.22.2 and isolated fixtures. Extend `config/youtube-preparation.e2e.mjs`, `config/transition-player.e2e.mjs` and the existing channel/settlement tests where they already observe the behavior. Use a representative 30-second recording and a crowded cache; a toy catalog alone missed a field failure.

| Inject | Required observation |
| --- | --- |
| Three consecutive eligible turns; delay the scene in one, drop the committed reserve reply in another, delay `STARTED` in the third | One foreground voice and one bed per eligible turn. Measure signal **after gain** before and during speech. The bed ends before a selected musical curtain; the curtain ends before the song. Without a curtain, retire the bed at the music handoff. |
| Lose warmup reply; delay first frame | Recover the same scene and rotation choice. Keep the outgoing picture or available poster. Do not wait for video to start audio. First frame and poster are distinct observations. |
| Disable ambience, remove the selected asset, or fill the cache while greetings prepare | Disabled means silence. Eligible decoded bed survives pressure within the memory cap; a genuinely unavailable optional asset has a bounded omission and does not stall music. |
| Change destination or authority mid-turn; redeliver an old reply after the next turn starts | No stale voice, bed, card, fade or history update. Rejection stops the affected action; missing acknowledgement alone never creates a second source. |
| Seek to the final five seconds, replay, block autoplay, delay incoming `PLAYING` | Warmup preserves outgoing volume and visibility. Seek is not end. A blocked start exposes recovery controls. Visual exit is anchored to playback, not the play command. |

## Rollout and rollback

### Stage 7: birthdays and idle ambience

In the V2 pilot a room boundary drains any active or pending idle ambience before a song or birthday takes ownership. A birthday scheduled during a directed handoff invalidates the pending promotion before reserving the celebration. Birthday phases still use `birthdayTimeline` and the existing renewable server permit, independently of the ordinary presentation deadline. After completion the scheduler reads the current queue again; a manual karaoke release is still required. Cancellation prevents a delayed finish from resuming a replaced turn.

Isolated check: `KARAOKE_E2E_MODE=development KARAOKE_E2E_PLAYER_V2=1 PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium mise exec node@24.22.2 -- node config/birthdays.e2e.mjs`.

### Stage 4 development pilot

On the development `/player` tab, run `sessionStorage.setItem('karaoke:player-executor', 'v2')` to opt in for the **next** eligible HOUSE transition with a scene or participant LISTEN request. Use `observe` (default) for V1 with passive comparison, or `legacy` for V1 without comparison. No reload is needed. The selector has no effect in production.

### Stage 6: karaoke

The same development selector also enables SING turns. The existing stage adapter supplies entry/call, reminders, countdown and the outgoing ending cue. Automatic starts continue after presentation. Manual turns wait on the server's renewable karaoke run: the presentation timeout cannot release the track. A matching queue and run must still be released after fading the bed; actual media playback acknowledges `played`. Re-entering a presented turn skips its call. Use `KARAOKE_E2E_MODE=development KARAOKE_E2E_STAGE_ONLY=1 KARAOKE_E2E_PLAYER_V2=1` with `config/karaoke-call-pilot.e2e.mjs` for isolated stage checks.

### Stage 5: listening requests

The director attempts the request presentation once, with the turn's cancellation signal and remaining budget. A handled presentation (including a screen-only card) advances directly to the song. A confirmed absence can use the ordinary announcement fallback; an ambiguous reservation must not trigger a second announcement. The greeting adapter retains card commit, reading time and server attribution. Withdrawing a greeting stops its foreground and its own bed, preserving an independently owned transition bed.

V2 starts the visual and ambience adapters independently, runs the intro, delegates the authorized voice/curtain sequence to the existing animator, and unlocks the shared queue promotion only after that sequence settles. The incoming media's play event drives exit; cancellation invalidates outstanding adapter callbacks. Look for `v2-turn-executing` and `v2-turn-released` in the development trace.

Isolated browser check: `KARAOKE_E2E_PLAYER_V2=1 KARAOKE_E2E_MODE=development KARAOKE_E2E_DELAYED_ACKS=1 mise exec node@24.22.2 -- node config/youtube-preparation.e2e.mjs`. Check the real development display and speakers before widening the allowlist.

Use one development selector (`legacy`, `observe`, `v2`) plus an allowlist of migrated recipes. Choose the executor before the first side effect and keep it for the full turn. If the operator disables V2 mid-turn, switch at the next safe boundary; for immediate stop, cancel, release or wait out the permit, then reselect. Never replay the interrupted transition on V1. Compare plan and outcome by turn ID without recording private greeting text. Review omitted layers, duplicate starts and handoff latency alongside audible/visual evidence.

**First implementation task:** add the normal-turn fixtures and pure plan tests from units 1–2, then connect the passive comparison. The first code review should be possible without starting a public player. The first decision to expand scope comes after unit 4, using both isolated evidence and an observed development-room pass.
