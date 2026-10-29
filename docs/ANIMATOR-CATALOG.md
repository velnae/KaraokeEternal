# Audio inventory architecture and recovery

`audioResources` is the canonical inventory. Generation jobs describe work;
the player preparation window describes cached media. Neither is the full
administrative catalog.

## Boundaries

| Area | Implementation |
| --- | --- |
| Shared resource/metadata/provider capabilities | `shared/audioCatalog.ts` |
| SQLite repository, query validation and metadata edits | `server/Animation/Resources.ts` |
| Legacy import and active runtime metadata projection | `server/Animation/catalog.ts` |
| Provider contract and ElevenLabs adapter | `AudioProvider.ts`, `ElevenLabs.ts` |
| Common media preparation | `AudioPreparation.ts` |
| Durable generation and upload registration | `Production.ts` |
| Authenticated inventory/media operations | `router.ts` |
| Bounded candidate selection | `preparation.ts` |
| Player decoded-buffer lifecycle | `AnnouncementAudio.ts`, `useAnimationPlayer.ts` |

## Resource lifecycle

Preparation is independent of administrative state:

- Preparation: queued, generating, preparing, ready, failed, uncertain or cancelled.
- State: active, disabled or archived.

Successful generation/upload registers a ready, active resource automatically.
Archive/deactivation survives restarts and repeated legacy imports. Files are
immutable; a generated alternative has a separate ID and `parentId`. Editing
metadata never changes the underlying file/checksum. Unknown descriptive fields
remain unspecified. Included room-neutral assets cannot be edited by one room.

Historical generation status names such as `published` and the runtime
`approvedForAuto` field remain compatibility details. They do not represent a
new manual approval requirement.

Deletion uses migration `018-audio-deletion.sql`: a `deletedAt` tombstone prevents
legacy manifests and production reconciliation from recreating removed resources.
Deleted resources are excluded from every inventory/runtime/media view. Their
usage and production history remain, including already incurred generation units.
The retired generation key permits a new explicit generation request, while a
restart never synthesizes a replacement. Files referenced by another resource or
job are retained; unshared files are removed. A file is renamed out of service
before committing deletion; database failures restore it. Cleanup failures are
logged and leave an unserved `.deleted-*` file for maintenance.

Included resources can also be deleted: migration `019-room-audio-deletions.sql`
records a persistent per-room deletion. Inventory, counts, preparation, previews,
downloads and manual Socket.IO requests all respect it. The shared file remains
available to other rooms and catalog import cannot reintroduce it in this room.

Deletion rejects resources owned by other rooms, unfinished preparation, pending
announcements, playing sequence segments and unexpired playback/ambience permits.
The UI confirms the action, defaults keyboard focus to Cancel, and restores focus
when the operator cancels. Successful deletion closes a matching local preview.

## Provider extension

Implement `AudioProvider` with:

1. Capabilities: stable ID/name, configured state, supported kinds/models,
   interpretation/language options and looping support.
2. A capability-specific connection check, returning voices when applicable.
3. Generation returning bytes and an optional provider request ID.

Register the adapter in the provider list passed to `CatalogProduction`.
Keep credentials inside the adapter/server configuration. The generator sends
typed inputs; do not insert provider-specific calls into the inventory UI,
upload path or player. The effect-only fixture adapter in `Production.test.ts`
proves generation without a voice catalog or an ElevenLabs model. Additional
real provider integrations are not included in this delivery.

Provider output and uploads pass through the same decoding, signal, duration,
normalization and checksum pipeline, producing 44.1 kHz stereo MP3 output.
Registration failures keep the generated
file and can retry registration without repeating the provider request.
Network/server ambiguity is retained rather than blindly retried.
Canonical generation keys reconcile omitted legacy provider defaults, preventing
an upgrade from synthesizing an identical existing request again. A deliberate
new-version form has its own request identity: retrying that submission is
deduplicated, while opening a new version request can create another alternative.

## APIs and inventory queries

All endpoints below are under `/api/animation` and require an administrator
with a room identity:

- `GET /resources`: kind, state, search, characteristic filters, sort/direction
  and page. Pages contain 20 resources, correct totals and type counts.
- `GET /resources/:id`: full metadata without a filesystem path.
- `PATCH /resources/:id`: owned-resource title, editable metadata or state.
- `DELETE /resources/:id`: remove an owned or included resource from this room's catalog when it is not in use.
- `GET /resources/:id/audio`: preview, including disabled/archived resources.
  `?download=true` provides an attachment; byte ranges are supported.
- `POST /resources/upload`: one bounded multipart file plus typed metadata and
  a request ID. Authentication occurs before multipart parsing. Temporary upload
  files are removed after handling.
- `GET /providers`, `POST /production/check`: compatible provider configuration.
- `POST /production/jobs`: durable generation requests.
- `POST /production/:jobId/register`: retry local registration only.
- `GET /catalog`: active, ready metadata for operator/runtime compatibility.
- `GET /preparation`: bounded preparation candidates for the authoritative player.

There is no manual review/publication endpoint in the new workflow. Cross-room
resource lookup, preview and mutation cannot disclose private resources.

## Playback memory and readiness

The full management inventory has no legacy 30-active/200-total manifest cap.
The player fetches a window of at most 24 distinct checksums, balancing resource
kinds/event families and least-recently-used candidates. Pending manual requests
and active interventions/ambience have preparation priority. This prevents the
newest inventory page from defining what can ever play.

The decoded buffer cache is bounded to 32 MiB. Playback pins its active buffer;
higher-priority candidates are retained before lower-priority ones. Preparation
is serialized and checks context generation before and after asynchronous work.
The 32 MiB bound describes retained decoded audio, not all browser memory: one
incoming decode, compressed responses, music/video and browser overhead are
additional allocations. Long-file ambience requires a separate transport design.

Catalog changes, pending interventions, completed playback and profile changes
refresh preparation. Server-side ready hashes and finite authority remain
required before public playback. Optional audio must not indefinitely hold music.
Preview is a separate HTML audio owner in the administrative browser and never
requests a public intervention.

## Migration and rollback

Migration `013-audio-resources.sql` is additive and clears obsolete microphone
flags. On startup, catalog reconciliation:

1. Imports legacy JSON records, including inactive ones, preserving IDs/scope.
2. Incorporates historical generation jobs beyond the old latest-100 list.
3. Reuses valid pending-review files without synthesis; preserves intentional
   rejection/deactivation and manual-only usage of included demos.
4. Detects missing/corrupt media and records an unavailable state.

The original `catalog.json` and media are retained; subsequent management edits
belong to SQLite. Reconciliation is idempotent and does not overwrite edited
names/states. Startup validates stored media without keeping every file in RAM.

Before deployment, take a consistent database backup and a copy of the audio
directory. If the server is running, use SQLite backup facilities or `VACUUM INTO`
rather than copying the main database without its WAL.

For rollback:

1. Stop the server. Archive the current database and audio directory as well,
   preserving resources created after deployment.
2. Restore the matching pre-migration database and audio-directory snapshot.
3. Start the matching prior application version.

Do **not** start old code directly against the upgraded database: this project's
migration runner can execute down migrations, and the old manifest cannot describe
all newly registered resources. New resources remain in the archived current
snapshot and become available again when restoring the newer version/snapshot;
the older application will not manage them automatically.

`server/Animation/migration.test.ts` rehearses the schema-12 upgrade, repeated
import and snapshot restoration while retaining a post-migration resource backup.
No production database was changed to perform that test.

## Verification record

Executed against the implementation based on `d167c3cd`:

| Check | Result |
| --- | --- |
| `npm test` | 369 tests passed in 46 files |
| TypeScript / scoped ESLint / `git diff --check` | Passed |
| Server and client builds | Passed; existing bundle/license/Browserslist warnings remain |
| Playback/announcement E2E | 16 passed in development and 16 in production |
| Inventory/generation/automation E2E | 17 passed in development and 17 in production |
| Administration/users/tables/QR regression | 19 passed in production |

No browser page errors occurred in successful runs. The inventory fixture adds
205 resources beyond the generated/demo assets, exercises pagination and a
server restart, and confirms the preparation window stays bounded. Dedicated
tests verify the decoded-memory limit, pending-request priority, snapshot
rollback, real MP3/WAV/OGG processing, disguised unsupported content, alternate
provider capabilities, local-registration recovery and version-request deduplication.

Inspected mobile/desktop screenshots of the inventory, controls, generation
forms for all three types, settings and generation failure. Keyboard preview,
dialog operation and responsive layouts are covered by the browser harnesses.
Search is exercised with rapid sequential keystrokes, not only bulk input
replacement. Its local editing value prevents asynchronous URL updates from
dropping characters; query changes do not move focus back to the page heading.

Temporary evidence on the implementation machine:

| Run | Directory |
| --- | --- |
| Inventory development | `/tmp/karaoke-phase2-e2e-MGyGCk` |
| Inventory production | `/tmp/karaoke-phase2-e2e-yGeZcY` |
| Playback development | `/tmp/karaoke-animation-e2e-Ek6FOB` |
| Playback production | `/tmp/karaoke-animation-e2e-RNxd4w` |
| Administration regression | `/tmp/karaoke-table-e2e-xbXpcM` |

Each inventory E2E run made 22 generation requests to its local simulated
provider; no real ElevenLabs credits were used. Live-account quality and
physical venue output were not tested. Minute-long ambience and additional
real provider integrations remain outside the implemented compatibility scope.

### Follow-up: expressive scripts and public usage

Implemented on baseline `e8e2e9c6`:

- Simplified filters, fixed type-specific columns, accessible icon actions and
  aligned inventory toolbar. Removed the duplicate player-launch link.
- Native textarea with a synchronized tag-highlight layer, keyboard tag insertion
  and documented v4 suggestions. Default voice is Alejandro Duran
  (`sKgg4MPUDBy69X7iv3fA`), subject to account availability; language is `es`.
  ElevenLabs scripts are sent without an injected interpretation prefix.
- `015-audio-usage.sql` and `server/Animation/usage.ts` provide room-scoped,
  idempotent confirmed-start totals, commercial-day counts and last-use timestamps.
  Historical first-asset starts are backfilled; secondary effects and ambience
  are recorded prospectively. `ASSET_STARTED` confirms a sequence's later asset;
  `ANIMATION_AMBIENCE_STARTED` confirms a finite permit using a stable idle-episode
  identity. Previews never emit either event.
- Existing voice repetition rules ignore bracket directions. Effects and new
  ambience episodes prefer least-used resources; an active ambience episode
  retains its cursor rather than switching files mid-pause.

Validation: 390 tests in 49 files passed; typecheck, scoped lint and both builds
passed. Playback E2E passed 16 scenarios in development and production; catalog
E2E passed 17 in each mode, including preserved tags/default voice, icon actions,
toolbar alignment, public-use counts, preview exclusion and restart persistence.
Mobile/desktop editor and usage-table screenshots were inspected.

Evidence: `/tmp/karaoke-phase2-e2e-zjikbM` (development),
`/tmp/karaoke-phase2-e2e-Qq72NV` (production),
`/tmp/karaoke-animation-e2e-k04quH` (playback development) and
`/tmp/karaoke-animation-e2e-a8BZBr` (playback production).
All generation requests used a local provider fixture, not a live account.

### Follow-up: permanent deletion

Validation: 440 tests in 54 files passed; typecheck, scoped lint and server/client
builds passed. Inventory E2E passed 18 scenarios in development and production,
including keyboard confirmation/cancellation, mobile/desktop screenshots,
preview shutdown, media removal, access isolation and restart persistence.
Unit tests cover active/uncertain playback, pending sequence effects, ambience,
shared-file retention and explicit regeneration without losing previous usage.

Evidence: `/tmp/karaoke-phase2-e2e-5bZYNU` (development) and
`/tmp/karaoke-phase2-e2e-phvLXz` (production). An initial development run hit the
120-second command timeout after the existing 17 scenarios; the complete rerun
with a 240-second command allowance passed. Each successful run used 22 simulated
provider calls. The venue's restored voices were checksum/decode validated and
remained ready after server restart; physical speaker quality was not evaluated.

Visibility correction: the Details footer keeps Download and Delete together on
the same row, outside the scrolling form. Included demos use the same enabled
Delete action. Browser assertions require complete initial viewport visibility
and matching button positions at 390×844 and 1440×768, before focus/click/scroll.
The earlier test's `scrollIntoViewIfNeeded()` hid this discoverability defect.
The included-audio case verifies deletion, denied media/manual playback, restart
persistence and continued access in another room. Updated 18-scenario runs passed
in development (`/tmp/karaoke-phase2-e2e-luJrG8`) and production
(`/tmp/karaoke-phase2-e2e-uAApNq`); screenshots were inspected. The 91 focused
animation/migration tests, typecheck, scoped lint and both builds also passed.
