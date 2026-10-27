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
