# Mobile YouTube requests

**Goal**: A participant scans a room QR, enters a display name, requests a YouTube karaoke video and understands its status without operator assistance.

**Baseline**: `develop` at `6b2608e3`, clean worktree. This is Karaoke Eternal; the user's reference to Conversa is interpreted as a request for focused, user-centered development, not a product change. UI copy remains neutral Spanish; technical artifacts remain English.

## Decisions

- Guest-first entry respects room permissions/passwords and existing sessions. Registered/admin entry stays available as a secondary action. Never silently enable guests in saved rooms.
- Participants get three destinations: Buscar, Mis pedidos, En la sala. Account remains accessible through the participant header. Operators retain existing management and local playback.
- YouTube-only participant discovery: visible karaoke filter enabled initially; readable title/channel/duration; no local library empty state. YouTube metadata cannot guarantee an instrumental track.
- Server-confirmed request receipt, inline sending/error states, authoritative pending allowance and approval mode. Never report success before acknowledgment.
- Network uncertainty must not create duplicate requests. Use a per-request identifier with a persisted server receipt, retry the same identifier, and recheck limits after asynchronous source resolution. No automatic quota-consuming search replay.
- Reuse existing FAIR/FIFO scheduling and lifecycle. Waiting times are estimates, hidden when player/connection/durations are unavailable. A phone requests music; the room player outputs audio/video.
- No provider deletion, new external dependencies, notifications service, SaaS features or unrelated redesign.
- **User refinement: minimal copy**. Prefer functional controls and compact state over permanent helper text. Happy-path entry/search must not require explanatory paragraphs. Keep accessible labels and show errors/limits/uncertainty only where relevant; operator approval is expressed by the request state.

## Work units and acceptance

- [x] **T1 — Guest entry**: QR/name happy path, password room, multiple rooms, disabled guests and secondary registered access; successful guest entry lands on search. Preserve login restoration and first-run setup.
- [x] **T2 — YouTube discovery and submission**: mobile search/filter/cards, send/receipt/error, empty/unconfigured/quota states, per-user allowance. No duplicate from double taps or retry after lost acknowledgment; reject concurrent requests over the limit.
- [x] **T3 — Personal requests and room status**: own pending/approved/playing/played/rejected/failed items, allowed cancellation, room now/next, honest estimates, disconnected/reconnecting feedback.
- [x] **T4 — Verification and UI/UX pass**: focused behavior tests, server/client type checks, scoped lint, isolated browser at 360/390px and desktop. Verify entry, request states, limits, cancellation, reconnect and no horizontal overflow; record what was simulated versus real.
- [x] **T5 — Reduce text density**: remove redundant helper prose, replace allowance paragraphs with a compact counter, make confirmed request state the navigation action, use contextual validation and retain accessible error/retry/limit feedback. Verify entry, search and own requests on mobile.
- [x] **T6 — Apply frontend-design**: install the project skill, define visual tokens, refine entry/search/request/navigation presentation, and critique screenshots while preserving T5's minimal-copy contract.

## Delivery and rollback

Work directly on user-selected `develop`. Keep the four work units reviewable with paired tests and this evidence document. Expected whole-feature size exceeds 400 lines; review by work unit rather than as one PR. No PR/push is part of this request. Commit creation requires explicit authorization. Rollback boundaries: entry components; participant discovery/receipt contract with its additive nullable database migration; participant navigation/views; documentation/evidence. Preserve existing accounts, queue and player fixes.

## Verification approach

- Vitest is a Node harness; use real temporary SQLite for queue/request invariants and pure tests for participant state calculations. Browser checks cover actual rendering and interactions without introducing a new test dependency.
- Use an isolated synthetic instance/data directory for browser mutations. Do not create test requests/accounts in the habitual port 3000 database or consume real YouTube quota for fixtures.
- Baseline known issue: global typecheck TS2604 at `Player.tsx:173`; historical global lint has existing failures. Record current results rather than claiming global green.
- Existing search throttle/stale-response protection, queue authorization and Spanish localization are retained.

## Progress and evidence

Implementation and scoped verification completed on 2026-10-06. Local commit delivery on `develop` was authorized in a follow-up request.

### Implementation map

| Unit | Files and behavior |
| --- | --- |
| Entry | `SignedOutView` and `Create`: guest-first, two-character name minimum, submit progress, room access explanation and secondary registered entry. Guest creation redirects to search. |
| Discovery | `src/routes/Participant/ParticipantView.tsx`, `useYouTubeSearch.ts`: 350ms debounce, stale response cleanup, 12s acknowledgment timeout, optional karaoke suffix, explicit search retry and per-result feedback. Reconnection does not automatically repeat searches. |
| Receipts | `requests.ts`, `server/Queue/{Queue,socket}.ts`, migration `007-request-receipts.sql`: persist identifier in session storage before send, scope SQL uniqueness to room/user/request, return current status plus authoritative queue on retries, recheck limit after video resolution. IDs use `getRandomValues` for HTTP LAN support. Lost acknowledgment remains uncertain until checked; no automatic duplicate submission. |
| Rules | `Rooms/participantPrefs.ts`, room HTTP/save/reconnect broadcasts: whitelist roles and normalized queue rules. A signed-in member can retrieve their own closed room to display its state. Admin draft preference pushes remain admin-only. |
| Follow-up | Participant views reuse existing scheduler, show own lifecycle outcomes and permitted cancellation, put the current song first, withhold unknown/paused/disconnected wait estimates. Cancellation confirmation includes a fresh queue; already-playing requests are not reported as cancelled. Late receipts cannot replace another signed-in user's queue. |
| Routing | `App/Routes`, `Navigation`, `Header`, `serverWorker`: participant destinations and account link; `/requests` registered in both client and server SPA route lists so direct links/reloads work. |

### Verification results

- `npm test`: **202/202 passed in 27 files**. New coverage includes six real temporary-SQLite receipt/cancellation cases, five client receipt cases, four participant rule/estimate/ordering cases, and one public preference projection case.
- `npx tsc -p config/tsconfig.server.json --noEmit`: passed.
- ESLint on every changed/new TS/TSX file: passed. Global `npm run lint` initially reported the known 29 unrelated baseline errors plus two new JSX spacing errors; the latter were corrected and scoped lint rerun successfully.
- `npm run typecheck`: only the known `Player.tsx:173` TS2604 baseline error remains.
- `npm run build:client -- --output-path /tmp/opencode/karaoke-mobile-build`: passed; final bundle suffix `719cdc30506aafa93e39`, eight existing license/asset-size warnings and Browserslist age notice.
- `git diff --check`: passed.

### Browser/UI evidence

Isolated development server at port 43187 with synthetic SQLite data, stubbed YouTube search/resolution and a separate synthetic administrator. Temporary runner: `/tmp/opencode/karaoke-mobile-preview.mts`. No real YouTube API calls were needed.

| Scenario | Result |
| --- | --- |
| QR room 1 → name → search; manual room selection | Passed, without registered-account fields; secondary login remains visible. |
| Guest-disabled room and password-protected room | Correct disabled explanation; password field required and correct password joins. |
| Search empty/error/quota/unconfigured | Correct inline states; retry available for transient errors. |
| Two requests reach configured limit | Remaining allowance updates; third new request disabled. |
| Lost acknowledgment | Fixture deliberately dropped one successful ACK. After timeout, Comprobar pedido returned the same receipt; exactly two total requests, not three. |
| Manual approval/rejection | Separate admin browser updated the guest's cards immediately. |
| AUTO setting change | Saved rule reached the guest; next request entered the queue directly. |
| Cancel own request | Confirmed, card removed, allowance restored. |
| Server restart and page reload | Reconnecting notice, session/queue recovery and direct `/requests` reload passed. |
| Active player / turn estimate | With a simulated IFrame API in a separate admin browser, guest saw Cantando ahora, next-song notice and a qualified 3-minute wait. No real audio/video playback was claimed. |
| 360, 390 and 1440px | No horizontal overflow or clipped tested titles; all new main buttons at least 44px high. |

The UI/UX pass fixed black-on-dark unstyled buttons, added visible focus/disabled states and safe-area navigation padding, shortened notices, clarified full-limit guidance and previous-request outcomes, associated actions with song titles, and removed a misleading empty state while confirmation is outstanding. The browser pass also found and fixed the server's missing SPA route for `/requests`.

Local visual evidence: `.playwright-mcp/mobile-youtube-search-final.png` and `.playwright-mcp/mobile-youtube-requests-final.png` (ignored artifacts). Console events during restart are expected connection failures; an existing missing guest-avatar request returned 404. No application exception was observed in the final participant flow.

### Remaining validation and use

Actual YouTube availability/playback and a physical phone/network remain manual acceptance checks. The room must permit new guests; access permissions are not silently changed. Open the QR in a guest browser to see the new participant UI; an administrator keeps the management interface. Restart/rebuild the usual service when needed to load server changes and the additive migration. No new external dependency or local-provider removal was introduced.

Rollback: entry can be reverted independently. Participant routes/views and request contracts must be reverted together if removed. Migration 007 supplies a down migration that drops only the request identifier/index and preserves queue items; keep an operational backup before any database rollback. Existing legacy clients can still submit requests without an identifier.

### T5 — User-directed text-density refinement

The user found T4's interface too text-heavy. This refinement replaces its permanent explanations with functional controls; the T4 screenshots above are historical, not the final visual direction.

- Entry now shows the room, a named input, **Entrar** and secondary **Tengo una cuenta**. The minimum-name hint appears only after an invalid field is blurred.
- Search uses a labeled-accessible field, magnifier submit button, **Karaoke** filter and a single YouTube source label. Removed introduction/empty-search panels, repeated approval/limit instructions, provider disclaimers and nonblocking player notices from search.
- A compact **1/2 pedidos** link replaces allowance paragraphs. At capacity, new-request buttons read **Límite alcanzado**. One request-state link (**Por aprobar**, **En la cola**) replaces the disabled confirmation button plus success paragraph plus repeated navigation link.
- Personal cards retain status, song/channel and cancellation. Waits use an approximate duration; failure recovery is an action. Player availability is shown in **En la sala**. Actual errors and uncertain confirmation remain contextual and actionable.
- Modified scope: `ParticipantView.tsx/css`, participant status label, `SignedOutView.tsx` and `Create.tsx`. Request/queue rules and persistence were not changed by T5.

Verification: scoped ESLint and `git diff --check` passed; existing participant model/receipt tests **9/9 passed**. Typecheck still reports only baseline `Player.tsx:173` TS2604. Isolated browser verified contextual name validation, guest entry, compact submission states linking to My requests, full-limit button, empty-result filter removal, retry/quota errors and lost-ACK checking without duplication. Layouts at **360/390/1440px** had no horizontal overflow or clipped tested titles; the search field starts around **158px** from the top at mobile sizes. The dev bundle compiled and rendered successfully; no new production build was needed for this visual refinement.

Current screenshots: `.playwright-mcp/mobile-minimal-entry.png`, `mobile-minimal-search.png`, `mobile-minimal-requests.png`. Testing used only the isolated synthetic instance at 43187; the habitual 3000 instance was not used for test mutations. The preview process was stopped afterward. Existing missing-avatar 404 and a transient socket connection warning were observed; no new UI exception.

### T6 design plan — stage and setlist

Skill installed at `.opencode/skills/frontend-design/SKILL.md`, pinned with its Apache-2.0 license to upstream `41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f`. Both file Git blob hashes match upstream. Project registry regenerated; restart OpenCode for automatic discovery, while the exact instructions are read directly in this session.

**Audience/job**: a participant in a karaoke venue, using one hand on a phone to choose the right video and track their turn. The application's existing neon wordmark supplies the venue identity.

| Token | Value / purpose |
| --- | --- |
| Stage | `#030509` — existing dark room background, comfortable in a venue |
| Equipment | `#111a28` — fields, request tickets and navigation surfaces |
| Lyrics | `#f4f7ff` — primary readable text |
| Secondary | `#a6b2c7` — channel, duration and secondary actions |
| Cyan | `#76e0ec` — primary action and selected navigation |
| Amber | `#edc47c` — waiting-for-approval state |

Type: retain locally hosted **Beon** for the wordmark only; use the existing native UI family for song titles/controls, with deliberate 30/17/14px hierarchy and restrained tracking. This avoids a new font download while keeping arbitrary YouTube titles readable. No decorative all-caps labels or added instructional copy.

Layout comparison: repeated bordered cards bury tracks in application chrome. Prefer a left-aligned setlist with consistent thumbnail/media slots, duration on the artwork, song/channel adjacent, and a clear request/state action. Personal requests remain distinct tickets with status and cancellation; only the current track gets a stronger visual accent.

```text
[Room icon + room]                         [Profile]
[What do you want to sing?]             [1/2 requests]
[Song or artist                               Search]
[Karaoke filter]                              YouTube
 thumbnail | song title / channel
  duration |                           [Request song]
-----------+----------------------------------------
 [Search]             [My requests]            [Room]
```

Critique before implementation: a generic neon dashboard with identical glowing cards would repeat the template pattern called out by the skill. Keep the glow in the existing entry wordmark; remove per-result card frames, emphasize video artwork and meaningful state color, and use an icon-and-label bottom dock. Touch targets, focus visibility, reduced motion and narrow-screen wrapping remain functional constraints.

Implementation complete: shared scoped tokens in `src/styles/participantTheme.css`; image-led search rows and status-specific request tickets in `ParticipantView`; reusable `SongArtwork` with a duration overlay and microphone fallback for missing/failed thumbnails; compact integrated search field; icon-and-label navigation dock; and a cohesive name-entry panel. Existing administrator navigation styles remain separately scoped. No new help paragraphs or external fonts/dependencies.

The screenshot critique found a doubled input focus treatment. The final search control has one group focus ring, while the submit button retains its own keyboard indicator. Duration metadata was increased to 12px. Reduced-motion preferences explicitly override component transitions; forced-colors navigation underlines the selected destination.

**Verification**:
- Upstream Git blob hashes match exactly: `SKILL.md` = `a5333457c414d20d625f307df945842c0952ecc3`; `LICENSE.txt` = `f433b1a53f5b830a205fd2df78e2b34974656c7b`. License and pinned source are stored alongside the skill. `.atl/skill-registry.md` regenerated (8 indexed filesystem skills) and mirrored to Engram.
- Focused participant tests: **9/9 passed**. Changed TS/TSX ESLint and `git diff --check`: passed. Typecheck still reports only the pre-existing `Player.tsx:173` TS2604.
- Isolated production client build: passed at `/tmp/opencode/karaoke-stage-build`, suffix `7195835feed4759a93a0`, with the same eight existing license/size warnings.
- Isolated browser using synthetic music results/artwork: entry, search, request confirmation, My requests, room view, full capacity and transient-error retry all exercised. Broken artwork switched to the microphone fallback. No page exceptions.
- At **320/360/390/1440px**, no horizontal overflow or clipped tested titles; buttons and navigation targets measured at least 44px. Primary-button text contrast measured **13.25:1**; keyboard focus was 2px; reduced-motion transition duration was `0s`; forced-colors selected-navigation underline was present.
- Final visual artifacts: `.playwright-mcp/stage-entry-final.png`, `stage-search-final.png`, `stage-requests-final.png`, `stage-desktop-final.png`. Provider/artwork were simulated; real YouTube/audio were not revalidated for this presentation-only pass.

The temporary preview is stopped after verification. The habitual development server remains available for the user to reload. Restart OpenCode to discover the project skill automatically in a new session; this pass used its exact instructions directly.

Follow-up: the user subsequently authorized the same treatment for administration and the player. See `admin-player-stage-ui.md`. The theme now lives at `src/styles/karaokeTheme.css`, and reusable artwork at `src/components/SongArtwork/`; the earlier T6 paths above record their original introduction.

### Commit preparation

The final diff review found that acknowledgment object spread retained the server's queue snapshot in each browser receipt. Receipt hydration and confirmation now select only the intended metadata fields; a regression covers both new responses and older saved entries. Queue synchronization remains separate in the participant view. Final suite: **203/203 passed**, frontend ESLint and diff checks passed; isolated client build passed with suffix `26f7f9a9a9e720cd7956` and the same eight existing warnings. This focused correction did not change the previously verified UI flow.

Authorized delivery groups: upstream design skill with license; durable server request contract with tests; connected frontend flows/shared stage presentation with client tests and both ODD evidence documents. The shared UI is kept together because its theme, role-based routing and motion safeguards have direct dependencies. No PR or push is part of this delivery.
