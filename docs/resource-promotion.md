# Promote tested resources from development to production

Use `npm run resources:promote` to compare, bundle and publish selected resources
through authenticated application APIs. It launches no browser and requires no
direct database access. Deploy the accompanying backend before promoting birthday
assets: older releases do not have `POST /api/birthdays/import`.

## Quick path

1. Resolve both rooms and the requested scope. Create a manifest under ignored
   `.atl/promotions/`, using the example below.
2. Export an administrator session for each environment to separate private files
   using the [session bridge](../.opencode/skills/youtube-resource-import/references/session-upload.md).
   Substitute the actual URL for each export. Never print cookies; keep exports
   outside the bundle and delete them in `finally` after execution.
3. Set `KARAOKE_PROMOTE_SOURCE_STATE` and `KARAOKE_PROMOTE_TARGET_STATE` to those
   file paths. The CLI retains only the exact host's `keToken` cookie and checks
   administrator status and room before doing work.
4. Run `plan`, inspect the summary and `plan.json`, then apply the fingerprint for
   the authorized scope. An explicit publish request authorizes applying that
   scope; a comparison-only request stops after `plan`.

```json
{
  "source": { "baseUrl": "https://dev-karaoke.puyu.pe/", "roomId": 1 },
  "target": { "baseUrl": "https://karaoke.puyu.pe/", "roomId": 1 },
  "audio": "all",
  "backgrounds": "all",
  "backgroundSettings": true,
  "birthdays": true
}
```

Room IDs are examples: resolve the intended rooms independently in both sessions.
Replace `"all"` with explicit resource-ID arrays to publish a selection. Omitted
arrays are empty and omitted booleans are false; there is no implicit production
URL or default room.

```sh
mise exec node@24.22.2 -- npm run resources:promote -- plan \
  .atl/promotions/request.json .atl/promotions/batch-001
mise exec node@24.22.2 -- npm run resources:promote -- inspect \
  .atl/promotions/batch-001/plan.json
mise exec node@24.22.2 -- npm run resources:promote -- apply \
  .atl/promotions/batch-001/plan.json --confirm FINGERPRINT_FROM_PLAN
```

`plan` only reads the environments and writes the local bundle. `apply` needs only
the destination session and bundle, so development can be offline afterward.

## Scope and behavior

| Selection | Published content |
| --- | --- |
| `audio` | Ready, room-owned voices, effects and ambience, including spoken text, family, modes, supported editable metadata and state. Shared included resources are skipped by `all`. |
| `backgrounds` | Ready videos; uploads alone stay inactive. |
| `backgroundSettings` | Mode, dimming, fixed selection and selected videos' activation. Includes the fixed video or all active source videos needed by rotation. |
| `birthdays` | Settings, model/voice choices, profile writing/style text, introduction bank and all referenced intro/music/video assets, including profile-specific videos and intro scripts. |

Existing destination resources are reused when their checksum and supported
configuration match. New resources use stable content/configuration identities;
retrying the same bundle reconciles accepted uploads. Files go through normal
destination validators. Audio may be normalized again, so the receipt stores the
destination checksum and verifies downloaded bytes rather than assuming identical
source and destination encodings.

Generated voices are transferred as existing audio with their approved text and
registered as uploaded resources, not new provider generation jobs. Generation
provenance remains in the source. The existing upload API makes valid audio
automatically eligible before its requested state is reconciled. The workflow
does not request public playback, but an already-running automatic animator may
use eligible uploaded audio.

Destination-only resources remain present, including active videos participating
in destination `all` rotation. Birthday configuration is replaced as a section,
not merged profile by profile. Users, credentials, `.env`, orders, playback state,
events, history, library paths and the database itself are never transferred.

## Recovery and verification

- Keep `plan.json`, media files and `receipt.json`. Do not edit fingerprints or
  invent request IDs. Resume with the same `apply` after recovering connectivity
  or authentication.
- Bundle hashes are checked before any remote write. Reused/completed resources
  are checked for drift. Changed target settings stop the operation. Settings use
  destination optimistic-concurrency revisions and are saved after dependencies.
- A lost settings response is reconciled by reading effective configuration;
  already-matching settings are not saved twice.
- A batch is resumable, not atomic across uploads. Earlier successful uploads
  remain on failure and the receipt reports `incomplete`. Failed preparations are
  not silently replaced with another identity.
- Receipts record mapped IDs, checksums and before/after settings. There is no
  automatic rollback or deletion; inspect partial results before correcting them.
- A `.lock` protects each bundle. Remove a stale lock only after checking its PID
  is no longer running. Avoid concurrent publication to the same room from
  different bundles.
- CLI verification covers API state and media integrity. Inspect the affected
  interface separately through HTTPS. Hashes do not prove public playback.

## Regression checks

```sh
mise exec node@24.22.2 -- npm test -- config/promote-resources.test.js
mise exec node@24.22.2 -- npm run test:resources:promote
```

The integration test starts two isolated servers and temporary data directories;
it does not connect to the development tunnel or VPS.
