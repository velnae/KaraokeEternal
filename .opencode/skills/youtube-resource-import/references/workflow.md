# Import resources from chat

Use `node --import tsx config/media-import.js` from the repository root. The
installed `yt-dlp`, FFmpeg and ffprobe do the processing; no MCP server is needed.

For video backgrounds, use the [background fast path](video-backgrounds.md)
for interval downloads, live preflight and activation/selection semantics.

## Quick path

1. Translate the request into a JSON manifest in `.atl/media-imports/`. For a
   short clip of a long source, download the interval first as described in the
   background fast path; the CLI's `url` input otherwise downloads the full source.
2. Run `prepare <manifest.json>` and keep the returned `receiptPath`.
3. For an import, use the [private session bridge](session-upload.md) to run
   `upload` with the existing authenticated browser session.
4. Return the receipt and verified result. For a download-only request, stop after
   preparation and provide the local file path.

```json
{
  "url": "https://www.youtube.com/watch?v=VIDEO_ID",
  "title": "Aplausos cortos",
  "destination": "audio",
  "kind": "effect",
  "start": "00:12",
  "end": "00:15",
  "roomId": 1,
  "metadata": { "effectType": "short", "category": "celebration" }
}
```

Replace the illustrative URL and room with the actual request and session.
Use `sourceFile` instead of `url` for existing local media; paths must be absolute
or relative to the repository root. Do not supply both.

```bash
node --import tsx config/media-import.js prepare .atl/media-imports/request.json
KARAOKE_IMPORT_STORAGE_STATE=/tmp/opencode/karaoke-import-session.json \
  node --import tsx config/media-import.js upload .atl/media-imports/RECEIPT_ID/receipt.json
node --import tsx config/media-import.js inspect .atl/media-imports/RECEIPT_ID/receipt.json
```

## Destination fields

| Destination | Required fields and behavior |
| --- | --- |
| `file` | `format: "mp3"` or `"mp4"`; no room or authentication needed. Defaults to MP4. |
| `audio` | `roomId`, `kind: "voice" / "effect" / "ambience"`; optional existing catalog `metadata`. Always MP3. |
| `background` | `roomId`; silent MP4 retained as an inactive catalog item, never activated or selected by the CLI. |
| `library` | `roomId`, `pathId`, `libraryPath` (absolute), `artist`; MP4 copied to the application's existing media folder and scanned. |

All require `title`. Times accept seconds, `MM:SS`, or `HH:MM:SS`, including
fractions. `start` defaults to zero; omitted `end` means source end. Explicit
manifest times take precedence; timestamp parameters in YouTube URLs are not
used. Convert any user-requested URL timestamp into manifest fields.

`baseUrl` defaults to `https://karaoke.puyu.pe/`. Preserve a deployment's URL
prefix (for example `https://host/karaoke/`). Plain HTTP is accepted only for
loopback regression servers. The CLI verifies administrator status and expected
room before any remote mutation.

### Limits and metadata

The CLI imports audio duration limits and background limits from the shared
application contracts. Current limits: voice 10 s, short effect 4.5 s, musical
separator (`effectType: "transition"`) 12 s, ambience 35 s, background 30 s/40 MiB.
Leave about 0.15 s below an audio limit for encoder padding. Never silently shorten
an exact user-requested range; ask for a revised range when it exceeds the limit.

The backend validates metadata, signal quality and normalized audio. A successful
HTTP response can still contain `preparation: "failed"`; the CLI treats this as
failure. Audio upload produces active/automatically eligible resources. It does
not request an announcement or alter playback controls.

Video backgrounds remain in the room catalog until explicitly deleted. In
**Animador → Fondo**, the operator can activate items and choose a fixed video
or all active videos in rotation. A fixed selection saved by the operator also
activates that video. Importing alone preserves the existing playback settings.

Library imports must run on the application host. Read `/api/prefs` to resolve
the requested existing `pathId` and `libraryPath`; never create a new media root
implicitly. MP3 alone is not a local karaoke song: that scanner requires a CDG
sidecar. The importer writes each MP4 in its own `youtube-ID` subfolder with an
isolated `_kes.v2.json` parser config using embedded artist/title metadata. It
does not alter the parent folder's parser. A `scan-requested` receipt requires
verification in the library UI; scanning is asynchronous and can fail.

## Reuse the authenticated browser session

Follow [the tested session bridge](session-upload.md). Its browser export needs
no module imports or new browser context. Keep credentials out of manifests,
receipts, command arguments and output; remove the private export in `finally`.

## Recovery and tools

- Reuse the same manifest/receipt. Stable IDs and backend lookup avoid duplicate
  resources after a lost response; source downloads are cached across recuts.
- Re-run `upload` to reconcile an uncertain submission or continue polling a
  preparing resource. Existing failed resources remain failed; report their reason.
- After a confirmed upload/activation, a later HTTP 502 does not undo success.
  Save the confirmed resource ID/state, make at most one bounded read-only recovery
  check, and report availability separately. Never resubmit because a recheck failed.
- Do not delete receipts/cache to force a retry. A genuinely changed request
  produces a new identity. Changed prepared bytes are rejected.
- A `.lock` records the owning PID. Remove it only after verifying that process
  is no longer running; there is no automatic stale-lock takeover.
- Override executable paths with `KES_YTDLP_PATH`, `KES_FFMPEG_PATH` and
  `KES_FFPROBE_PATH` when needed. The downloader deliberately ignores ambient
  yt-dlp config, processes one finished video, and uses bounded retries/timeouts.
- Source downloads are limited to two hours/2 GiB; large sources may require a
  separate workflow. Cache files remain local for reuse and explicit cleanup.
- If YouTube rejects extraction, report the blocker. Do not claim an external
  download passed based solely on local fixtures or FFmpeg conversion.

## Implementation and checks

- [Preparation CLI](../../../../config/media-import.js)
- [Authenticated registration](../../../../config/media-import-api.js)
- [Focused tests](../../../../config/media-import.test.js)
- [Isolated real-API regression](../../../../config/media-import.e2e.mjs)

```bash
npm test -- config/media-import.test.js
node --import tsx config/media-import.e2e.mjs
```
