# Contextual transitions — incremental delivery plan

**Status: batch 1 and the private batch 2 pilot are implemented and technically
verified; user acceptance, including real-voice listening, remains pending.
Batches 3–6 remain planned.**

Build on the existing transition video, pause ambience and player coordination.
Each batch delivers a usable increment. Resolve its listed choices when starting
that batch, demonstrate the result, and obtain user acceptance before advancing.
This plan does not authorize audio generation or public playback.

## Agreed experience

| Area | Delivery contract |
| --- | --- |
| Main presentation | Feature the incoming track. For singing, emphasize table and performer; for listening, track and requester/table; for house music, track and venue selection. |
| Following track | A smaller `Después` area shows the following track's type, title and applicable table/person. It is visual only and hidden when absent. |
| Animator transcript | Remove the animator's spoken-text overlay. Keep useful track information and dedicated greeting/dedication content. |
| Listening and house music | Continue general animator audio during transitions. Removing its transcript must not silence it. |
| Karaoke | A recognizable friendly cue, then table, performer and song presentation, replaces the general announcement. Do not play both presentations. |
| Timing | Preserve the approximately two-second video/ambience lead-in, one continuous scene and the configured ambience volume during speech. Start music after the authorized voice finishes and the media is ready. |
| Audio composition | Reuse recordings for tables 01–14. Prepare the cue, table fragment and continuation as one finished audio file before playback. |
| Personalization | Prepare names/titles ahead of playback. A missing or late personalized asset falls back to the prepared table call rather than holding the music for synthesis. |
| Existing controls | Preserve player authority, pause/skip behavior and room controls. No new microphone-occupancy control or parallel player/scheduler. |

Exact scripts, dynamic-generation policy and greeting/call ordering remain batch
decisions. The suggested cue `¡Vamos con el karaoke!` is not yet an approved
recording. The existing 10-second animator-voice limit applies to the complete
composed call, not independently to each fragment.

## Delivery map

| Batch | Usable increment | Acceptance outcome |
| --- | --- | --- |
| 1 | Incoming/following-track presentation | Correct, readable information; existing audio still works. |
| 2 | Hybrid audio pilot with local preview | Natural-sounding saved cue/table + Gemini continuation. |
| 3 | Live table calls for all 14 tables | The correct table is called only for a singing request. |
| 4 | Personalized preparation and private preview | A request can produce a ready, reusable personalized call. |
| 5 | Personalized calls in live transitions | Correct automatic delivery, with reliable static fallback. |
| 6 | Venue rehearsal and accepted delivery | The complete experience works on the venue's actual setup. |

### Batch 1 — Show the incoming and following tracks

**Deliver:** replace the animator transcript with the main track presentation and
`Después`, using the actual player queue order. Show the information during the
existing transition scene without restarting its video or audio. Keep the current
spoken behavior during this visual-only increment; karaoke routing arrives in batch 3.

**Resolve at start:** visual hierarchy/copy, missing metadata, operator/unknown
requests, and classification precedence between `requestIntent` and `origin`.
Do not infer singing intent from a video title or media format.

**Accept when:** all nine incoming/following combinations of singing, listening
and house music render correctly; empty/final queues hide obsolete information;
queue changes update both areas. General voice, greeting content and player
recovery controls remain functional.

**Verify:** focused presentation/queue tests, HTTPS desktop/mobile screenshots,
and a transition smoke check with existing audio. Removing this presentation must
not require reverting the audio coordinator.

#### Batch 1 delivery — 2026-11-05

Implemented in `PlayerTransitionPresentation.tsx` and its CSS, with pure data
selection in `transitionPresentation.ts` and integration in `PlayerController.tsx`.

- Reuse Beon for short karaoke/venue labels and the existing sans-serif for large,
  readable names/titles; cyan karaoke, amber house selection, white main text.
  Container-relative sizing adapts the central presentation and the lower
  `Después` band to desktop, portrait and landscape. Long text is clamped and the
  single fade respects reduced motion.
- `HOUSE` takes precedence over request intent; explicit `SING` and `LISTEN`
  select their presentations. Unknown requests use `Próxima canción` without
  inferring intent from a title. Table labels use the stored request snapshot.
  House music does not expose the operator as its requester. YouTube channel names
  are not presented as artists; only known local artist metadata is displayed.
- The incoming song stays visible during media loading. `Después` projects the
  following boundary through the existing round-robin scheduler: unused house
  tracks can be outside the current scheduled result. No playback order is mutated.
- Animator and greeting-intro transcripts are replaced by track information.
  Greeting messages keep their recipient/sender and get a compact musical header.
  Existing voices, effects, two-second intro and independent ambience remain active.
- A playback test exposed a pause arriving while the previous ambience was being
  released. Version/mount checks after asynchronous boundaries prevent that stale
  continuation from reopening the scene or starting a new transition after pause.

Verification completed:

| Check | Result |
| --- | --- |
| Focused presentation, queue and audio tests | 49 passed, including 19 presentation/context tests. |
| TypeScript and changed-file ESLint | Passed. |
| Client production build | Passed; existing dependency-license and bundle-size warnings remain. |
| Transition/player harness | Passed in development StrictMode and production. |
| Greeting playback harness | Passed in development StrictMode and production, including keyboard playback, delayed delivery, long greetings, withdrawal and restart. |
| HTTPS transition harness | Passed against the real `https://karaoke.puyu.pe/` frontend with isolated API/socket fixtures; shared room data/playback were not used for destructive scenarios. |
| Visual checks | Reviewed desktop, mobile and landscape screenshots; all nine type combinations and long names/titles tested while animator audio continued. |

Focused command:

```sh
npm test -- src/routes/Player/components/Animation/transitionPresentation.test.tsx src/routes/Queue/selectors/getRoundRobinQueue.test.ts src/routes/Player/components/Animation/AnnouncementAudio.test.ts
```

Harnesses use `TMPDIR=/tmp/opencode` and, for greeting playback,
`PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium` to reuse the installed browser.
The HTTPS run uses `KARAOKE_E2E_MODE=development KARAOKE_E2E_HTTPS_UI=1` with
`npm run test:transitions:player`.

Evidence directories from this delivery:

- HTTPS transitions: `/tmp/opencode/transition-player-FbZKd5`.
- Production transitions: `/tmp/opencode/transition-player-efPobh`.
- Development greetings: `/tmp/opencode/g-audio-e2e-dorzwh`.
- Production greetings: `/tmp/opencode/g-audio-e2e-G6hEiZ`.

**Acceptance:** pending the user's visual review. No new voice generation or
table-specific spoken calls were introduced; these remain batches 2–5.

### Batch 2 — Hybrid audio pilot

**Status: private hybrid pilot implemented and technically verified.** See the
[batch 2 implementation plan](HYBRID-KARAOKE-PILOT-PLAN.md) for the project-aligned
data model, shared Gemini integration, table manager, private API and increments 2A–2D.
Its delivery section records the actual checks and remaining acoustic acceptance.

**Deliver:** reusable introduction variants, audio bound to pilot tables 01/03/14
in the existing table manager, and a Gemini-generated performer/song continuation.
The server composes one finished file for private listening. Compare three hybrid
calls against the same three complete-phrase references before expanding the bank.

**Resolve at start:** exact scripts, voice/model, pronunciation, recording in
context, join points, pauses and source format. Use a common Gemini base profile
for all pieces, with explicit role-specific delivery instructions. Approve the
scripts and generation scope before submitting provider work.

**Accept when:** hybrid calls sound continuous, identify each table clearly and
fit the measured voice-duration limit without cutting words or accelerating speech.
Preview closure stops playback. Source fragments cannot accidentally become
standalone public announcements.

**Verify:** composition/duration tests and actual listening to the rendered pilot.
Reuse the existing Gemini generation gate and audio preparation, with internal
storage separate from the public catalog. Ready catalog resources can become
eligible, so ordinary catalog publication is not an isolation mechanism. Private
pilot inputs do not yet trigger preparation or playback for real queue requests;
batches 4–5 integrate that lifecycle using the accepted service.

**Delivered:** Llamados administration, persisted introductions, table voice editor,
hybrid composition, complete-phrase references and private listening. The automated
three-table A/B scenarios passed in production and development/HTTPS with simulated
Gemini responses. Real model pronunciation/joins still require the user's listening
approval; no paid or public-room audio was generated as a test side effect.

### Batch 3 — Deliver live table calls with generic continuations

**Deliver:** extend the accepted sound pattern to tables 01–14 and integrate it
with singing transitions. A complete prepared table call replaces the general
announcement; listening and house tracks retain general animator behavior.
No personalized synthesis is required yet.

**Resolve at start:** final continuation variants, table identity/renaming and
missing-table fallback; call priority relative to greetings/manual announcements;
and operational calls versus existing repetition/voice-budget rules. Preserve
room disable/pause controls and agree on how omissions are communicated.

**Accept when:** the immediate singing request receives its own table call, never
the table shown in `Después`. Missing table audio uses a neutral fallback, never
another table. A greeting can coexist under the agreed order without a duplicate
presentation or video/ambience restart. Each valid transition is claimed once.

**Verify:** table selection, all three track types, greeting coexistence, changed
queue, cancelled request, skip/pause and duplicate-event regressions; development,
production and HTTPS playback. The rollback boundary is table-call routing;
batch 1's screen and the existing general animator remain usable.

### Batch 4 — Prepare personalized calls and preview them

**Deliver:** connect the accepted pilot service to real musical requests and
prepare their personalized continuation and complete cue/table composition while
they wait in the queue. Show simple preparing, ready and failed states with private
listening and a useful next action. Public playback still uses batch 3's static
calls while this automatic-preparation increment is evaluated.

**Resolve at start, rather than choosing now:**

- Whose name to speak: requester alias, a performer entered for this request, or a
  group name; define the minimal input/editing UI if needed.
- What to say: table, performer, clean song title and optional artist; decide how
  long titles or missing data are shortened in the script while remaining visible.
- How to reuse the pilot's accepted Gemini profile and handle deliberate profile
  changes; whether listening requests need any personalized variant. The agreed
  initial use is karaoke, with general announcements for listening/house music.
- When preparation starts, which pending requests to prepare, provider limits,
  retry rules and cache retention. Estimate generation scope before execution.
- Cache identity and invalidation when request text, table, voice or source
  fragments change; recovery after cancellation or server restart.

**Accept when:** one request produces a measurable, playable composed result;
repeated preparation of unchanged input reuses it; edits invalidate stale output;
failure leaves the musical request valid and the static fallback available.
Generation never depends on the request containing a greeting. Access remains
room-scoped, and personalized assets stay out of general catalog rotation.

**Verify:** preparation lifecycle, reuse/invalidation, provider failure, restart
and room-isolation tests, plus HTTPS private preview and listening approval. Reuse
provider/audio-preparation infrastructure and job patterns without treating the
existing greeting-specific database workflow as a generic announcement service.
This batch can be rolled back without removing batch 3's live calls.

### Batch 5 — Use ready personalized calls during playback

**Deliver:** preload the appropriate prepared call and play it through the existing
authorized transition. If unavailable, use the accepted static table call. Keep
the same track information, background, ambience and ordinary animator behavior
for listening/house music.

**Resolve at start:** the final playback snapshot, treatment of edits after
preparation, operator-visible fallback reasons and the behavior when even the
static asset is unavailable. Reuse batch 3's greeting/call ordering.

**Accept when:** displayed and spoken table/person/song belong to the same current
request; changed/reordered/cancelled requests cannot speak stale identities;
slow or failed synthesis does not delay a transition. Pause, skip, replay,
disconnect/reconnect and duplicate acknowledgments do not produce overlapping or
repeated calls. Personalized delivery is recorded only after confirmed playback.

**Verify:** focused coordinator/lifecycle tests and isolated development/production
regressions, including delayed provider responses, missing assets and greetings;
exercise the affected HTTPS flow. Roll back personalized selection independently
to batch 3's static calls while retaining prepared resources.

### Batch 6 — Rehearse the complete venue experience and deliver

**Deliver:** the integrated increment with an operator walkthrough and recorded
acceptance on the actual display, speakers and microphone-handoff workflow.

**Resolve at start:** listening levels, acceptable pacing, final script/visual
adjustments and any explicitly accepted remaining limitations.

**Accept when:** the user approves the nine track-type combinations, all 14 table
numbers, personalized/static fallback, greetings, queue end and operator controls.
Verify name/number intelligibility and no audible gaps between composed fragments.
Do not reintroduce automatic ambience ducking. Record exact failures or pending
checks rather than treating file availability as acoustic acceptance.

**Verify:** a representative full venue sequence over HTTPS and targeted
regressions for any rehearsal fixes. Earlier batches already carry their tests;
this is operational acceptance, not a postponed testing phase.

## Verification and batch receipt

For each implemented batch, keep its tests and documentation with the behavior.
Use focused `npm test -- <affected-test-path>`, changed-file ESLint and
`npm run typecheck` for TypeScript. UI work includes HTTPS Playwright, desktop/mobile
screenshots and keyboard checks for changed controls. Audio lifecycle changes also
require isolated development/production runs using the relevant existing harnesses:

- `npm run test:transitions:player`
- `npm run test:animation:phase2`
- `npm run test:greetings:playback`
- `npm run test:greetings:audio` when preparation changes affect that shared flow

The harness mode is selected with `KARAOKE_E2E_MODE=development` or `production`;
build the required targets only when their production check needs updated output.
Keep fixtures/destructive cases off shared data. Documentation-only changes need
reference review and `git diff --check`, not application builds.

At each handoff, record:

```text
Batch:
Decisions resolved:
Working increment and demonstration:
Checks run and actual results:
Remaining limitations:
User acceptance: pending / accepted / changes requested
Rollback boundary:
```

Acceptance of a batch does not automatically approve the next batch's undecided
scripts, paid generation or implementation. No batch is marked accepted by this plan.

## Existing integration points

| Existing area | Role in this plan |
| --- | --- |
| `src/routes/Player/components/PlayerController/PlayerController.tsx` | Queue-derived transition, two-second intro, current transcript overlay and greeting-before-general-announcement ordering. |
| `src/routes/Player/components/Animation/PlayerTransitionScene.tsx` | Shared video scene; preserve its continuity while information changes. |
| `src/routes/Player/components/Animation/AnnouncementAudio.ts` | Existing prepared voice/ambience playback channels. |
| `server/Animation/Animation.ts`, `selection.ts` | Existing authority, reservations, readiness and family-based selection; table context must be added deliberately. |
| `server/Animation/Production.ts`, `AudioPreparation.ts` | Existing provider worker and validated audio preparation. |
| `server/Greetings/transition.ts`, `AudioJobs.ts` | Greeting-specific preparation/delivery patterns and coexistence boundary. |
| `shared/animation.ts`, `shared/audioCatalog.ts`, `shared/types.ts` | Existing duration, resource, request-intent and queue contracts. |

The existing implementation is documented in [the transition-video plan](TRANSITION-VIDEO-PLAN.md).
Update this document with each batch's agreed decisions and acceptance evidence.
