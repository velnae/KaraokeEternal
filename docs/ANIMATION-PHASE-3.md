# Greetings attached to song requests

Participants can add one optional greeting after confirming each musical request. Greetings
are shown automatically before their associated song. The operator can moderate
the queue without approving every message. Phase 4 block 3 changed the original
turn-wide grouping to per-song delivery; optional voice playback is documented in
[ANIMATION-PHASE-4.md](ANIMATION-PHASE-4.md).

## Use the feature

1. Find a song by searching or pasting a YouTube link.
2. Select **Pedir canción**. A matching server confirmation navigates to **Mis
   pedidos**, focuses the exact song card and briefly highlights it. An uncertain
   request stays on Search with **Comprobar pedido**; checking reuses its receipt.
3. Select **Agregar saludo** on the song card. Enter a single **Mensaje**, then
   **Guardar saludo**. The Unicode character counter reserves space for the
   automatic sender within the existing 220-character total (211 for a sender
   named Ana). There is no separate recipient field or greeting checkbox in Search.
4. **Cancelar** closes the editor while retaining the draft and musical request.
   A failed save retains the message. An uncertain save locks it for **Comprobar
   saludo** rather than submitting a different message. Confirmed greetings appear
   inline and can be withdrawn with **Quitar saludo** while queued.
5. Open the room's player. Each greeting appears before its associated musical
   request, then playback continues. Text delivery does not require enabling
   the animator, unlocking its audio, or installing a voice provider.
   The operator can work in the queue tab while the player remains in another tab.

For a two-song FAIR turn: request A + greeting X, request B + greeting Y produces
X → A → Y → B. Each visual-only greeting stays visible for 10–15 seconds according to its text
length. A greeting cannot be submitted independently of a musical request.

### Configure the actual turn

**Pedidos pendientes** and **Canciones por turno** are different room settings.
The defaults are two pending requests and one song per turn. To use the example
above, configure two songs per participant turn with FAIR rotation. This feature
does not change room preferences. FIFO preserves its existing semantics: each
request is a separate turn, even when consecutive requests have the same sender.
Multiple people at one table keep independent participant turns.

## Operator controls

Each musical card includes its greeting and contextual moderation action. Sender,
table and song information already belong to the card and are not repeated in a
separate greetings panel. Cards without greetings have no greeting placeholder.

| Control | Effect |
| --- | --- |
| Quitar saludo | Withdraw a queued/reserved message from its song card. |
| Retirar saludo | Remove the currently displayed message from its song card. |
| Pausar saludos | Compact queue-toolbar control; stop current delivery and skip greetings for turns that begin while paused. Music continues. |
| Reanudar saludos | Allow greetings for upcoming turns; skipped messages are not replayed late. |

The normal pending state is implicit in the musical queue. Only meaningful delivery
outcomes are highlighted, such as **En pantalla** or **Mostrado**. Technical voice
states and expandable failure reasons are reserved for the operator. Participant
cards show the message and delivery outcome; **Quitar saludo** replaces **Agregar
saludo** in the action row beside **Cancelar pedido**. The editor normally shows
only its character counter below the field, with actionable errors when needed.
Removed messages show a short outcome instead of retaining
the withdrawn text. The room-wide pause control appears only when relevant.

Messages are eligible automatically. There is no greeting approval state. The
musical request still respects the room's own song-approval configuration.
Moderation is reactive: a message can appear before the operator notices it.
Pending messages are visible only to their author and the room's administrators.

## Delivery rules

- One greeting per accepted request; the request's durable receipt also identifies
  its greeting. The assembled text is limited to 220 Unicode code points.
- New greetings are attached through the authenticated `attach` operation with
  `{queueId, message}`. The server owns room/sender/table attribution and rejects
  foreign, cancelled or already consumed requests. The message is normalized to
  NFC; new records use an empty recipient while historical greetings remain readable.
- The musical receipt and greeting save are independent. Failed greeting validation
  never resubmits or cancels the song. The unique greeting-to-request relationship
  makes identical attachment retries idempotent, including a lost acknowledgment.
  Older combined musical submissions remain supported for durable receipt recovery.
- The greeting window closes when that particular song's transition is reserved,
  even before the music starts. A later pending song in the same participant turn
  can still receive its greeting. Pending approval can accept a message; voice
  preparation waits for approval. Provider readiness/quota never blocks the save.
- The song scheduler supplies the turn boundaries. Greetings do not reorder music
  or create their own rotation. Consecutive turns by the same singer retain the
  configured capacity.
- Canceling a song cancels its unshown greeting. Surviving greetings remain attached
  to their own songs. There is no arbitrary
  fifteen-minute expiration while a valid musical turn is waiting.
- Canonical turn membership continues to describe musical ordering. Delivery is
  consumed separately for each song, so its next song can present its own greeting.
  Replay, duplicate player, reconnect or server restart cannot repeat a consumed message.
- Display is acknowledged only by the authoritative room player after React commits
  the matching greeting card to its DOM and completes the reading interval. This
  records delivery to the player, not proof that a person was watching that tab.
  A missing DOM commit is bounded and cannot be acknowledged as displayed.
- Backgrounding the player tab does not omit, interrupt or restart a greeting.
  The commit acknowledgment does not use `requestAnimationFrame`, which browsers
  can suspend in background tabs. Returning during a greeting shows its current
  card without starting another interval.
- Musical commands, microphone use, room closure, context changes, navigation away
  from the player or connection failures stop the sequence. Reservations and network waits
  are bounded so greetings cannot indefinitely hold the musical queue.
- An existing manual animator intervention has priority. Otherwise a greeting
  sequence takes the opening instead of an automatic generic announcement.

## Implementation boundaries

| Subphase | Implementation |
| --- | --- |
| 3A | `shared/roundRobin.ts` exposes canonical turn metadata; migration `016-greetings.sql` stores greetings, consumed turn membership and pause state; request insertion and receipts preserve idempotency. |
| 3B | `GreetingComposer` is a single-field inline editor in My requests. `ParticipantView` navigates only after the current confirmed submission; `useGreetings` supplies authoritative availability per song. |
| 3C | `useGreetingPlayer` runs inside the existing `PlayerController` transition gate with existing room player authority. It renders text without using the animator audio lifecycle. |
| 3D | `QueueGreeting` shows contextual state/actions in musical cards. `useGreetings` shares one scoped subscription per list for authors and operators. |

The shared scheduler and player-history merge are re-exported from their previous
client paths. Both server and player use the same persisted/transient history order,
including recovery after reconnect.
The service uses existing SQLite and Socket.IO. No additional process or provider
is required. One shared subscription per list refreshes greeting state every
1.5 seconds, instead of polling from every card. The player checks
active delivery about every 400 ms; network delays can extend those intervals.

## Verification

The post-request flow has 113 passing focused tests, successful typecheck/lint and
builds, plus passing greetings and voice-playback browser suites in development
and production. The participant flow also passed with HTTPS-served frontend assets
and an isolated API. Mobile 390px and desktop 1440px screenshots were inspected.

The broader 670-test run passed 669 tests; the existing 35-second ambience production
test exceeded its default 5-second execution timeout. That unchanged test passed
when run alone with `--testTimeout=15000` (about 5.3 seconds). Its media assertions
and production time limits were not changed.

```sh
npm run typecheck
npm test
npm run build:server
npm run build:client
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:greetings:e2e
KARAOKE_E2E_MODE=development PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:greetings:e2e
KARAOKE_E2E_MODE=development KARAOKE_E2E_HTTPS_UI=1 PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:greetings:e2e
```

The E2E harness uses an isolated database, an actual QR admission, a local HTTP
YouTube metadata fixture, browser submissions and real local MP4 playback. After
submitting through the search UI, test queue items are explicitly mapped to local
media to avoid depending on live YouTube playback. It checks per-song greetings,
confirmation-driven navigation, focused cards, a one-field editor, draft retention,
lost song/greeting acknowledgments, moderation, pause/resume, reload, duplicate player authority,
keyboard input and 390/1440px layouts, saving screenshots and logs in its printed
temporary directory. This does not certify live YouTube or physical venue display
legibility. HTTPS mode loads participant UI assets through `karaoke.puyu.pe` and
forwards all test API/socket traffic to the isolated server; it never joins the
shared room. Lost WebSocket acknowledgment injection is exercised by the local modes.

The background regression starts playback from the queue while explicitly modeling
a hidden player document, suspended animation frames and timers coalesced to at
least one second. It switches tabs during delivery and checks unchanged start time,
the second greeting's independent DOM commit and musical continuation. This avoids
relying on headless Chromium's more permissive background behavior. The same test
reproduced `SKIPPED` with no reservation before the fix.

Focused tests cover migration, permissions, same-user consecutive turns, pending
song approval, cancellation/reordering, long waits, request retries, recovery and
stale/foreign player acknowledgments. Existing audio E2E remains a regression gate
for changes to the shared musical transition.

### Original phase-3 verification results (before per-song delivery)

| Check | Result |
| --- | --- |
| TypeScript typecheck | Passed. |
| Full unit/integration suite | 430 tests in 53 files passed after background-player delivery repair (initial phase-3 baseline: 390). |
| Lint of changed TypeScript/JavaScript | Passed. |
| Server and client builds | Passed; existing bundle-size/license/Browserslist warnings remain. |
| Greetings E2E, production | All 6 scenario groups passed, including background-player delivery and tab changes; artifacts `karaoke-greetings-e2e-tFCoae`. |
| Greetings E2E, development StrictMode | All 6 scenario groups passed; artifacts `karaoke-greetings-e2e-6bVRBk`. |
| Manual animator E2E regression, production | All 16 scenario groups passed; artifacts `karaoke-animation-e2e-w9sV84`. |
| Automatic animator E2E regression, production | All 17 scenario groups passed; artifacts `karaoke-phase2-e2e-EBbhHf`; provider calls simulated. |
| Responsive inspection | Composer, own requests and administrator cards inspected at 390/1440px; pause control verified fully visible on mobile. |

Artifact directories are under the test machine's temporary directory. Repository-
wide `npm run lint` still reports 28 existing errors in unchanged Babel, media,
rooms, scanner, user, logging and entrypoint files. These are separate from the
changed-file lint result. Physical venue display readability and live YouTube
playback remain external checks.

## Upgrade from the early phase-3 schema

Some development installations applied migration 016 before its `position` column
was introduced. Changing an already recorded migration does not run it again.
Migration **017-greeting-turn-position** repairs those databases additively and
preserves requests, greetings and consumed turn records. Databases that already
have the column retain their existing sequence positions.

The migration runner recognizes the narrowly scoped directive
`-- If column missing: table.column`: it executes that migration's Up body only
when the named column is absent, and records the migration in either case.
Migration 017's Down is deliberately non-destructive because later revisions of
016 already include this column. Future schema changes require a new migration;
editing 016 is not an upgrade strategy. Unexpected SQLite errors in greeting
operations are now also logged by the server, not only returned to the player.

Upgrade tests cover both revisions of 016 with populated requests, greeting history
and consumed turns, including a second startup and foreign-key checks. The browser
harness also starts from the missing-column variant before exercising delivery.

## Operational rollback

Use **Pausar saludos** to stop greetings while retaining song requests and
their history. Keep the migration installed. Binary downgrades that omit a schema
file run its Down migration in this application; restore a matching database
backup when reverting binaries instead of assuming schema preservation.

Phase 4 supplies Gemini voice preparation while preserving automatic eligibility
and optional moderation rather than introducing mandatory greeting approval.
