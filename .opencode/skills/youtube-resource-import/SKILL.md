---
name: youtube-resource-import
description: "Trigger: descargar YouTube, yt-dlp, recortar MP3, cargar fondos de video. Import media from chat and apply requested background activation."
license: Apache-2.0
metadata:
  author: "Karaoke Eternal"
  version: "1.1"
---

# YouTube Resource Import

## Activation Contract

Use for chat requests to download, trim or import YouTube/local media. Read
[workflow](references/workflow.md); for video backgrounds also load the
[background fast path](references/video-backgrounds.md).

## Hard Rules

- Use the import CLI and authenticated APIs. Apply only requested catalog or
  background-setting changes; never write SQLite or interrupt playback.
- Resolve URL, range, destination and room from the request. Ask one question
  when a consequential field is ambiguous; never invent a source or crop.
- Keep source, prepared files and receipts under ignored `.atl/media-imports/`.
  Keep authentication in a separate private temporary file; never print it.
- Prefer interval downloads for short clips from long videos. Keep original URL
  and time range in a sidecar receipt when preparing a local fragment.
- Inspect current room/catalog/settings rather than relying on past limitations.
  Background upload, activation, fixed selection and rotation are separate actions.
- Explain that ready audio uploads become automatically eligible. Video uploads
  start inactive; activate or select only as requested.
- Preserve receipt IDs on retry. Report failed/pending states honestly; never
  regenerate an ID to bypass an existing failed upload.

## Decision Gates

| Request | Destination |
| --- | --- |
| Download/trim only | `file` (MP3 or MP4) |
| Voice, applause, separator, ambience | `audio` with kind and metadata |
| Transition background | `background` (silent MP4); follow requested activation/selection |
| Local karaoke song/video | `library` (MP4, application host and configured path) |

## Execution Steps

1. For imports, inspect session, room and relevant catalog/settings in one HTTPS
   preflight. For download-only requests, skip authentication.
2. Reuse receipts/files, download only the requested interval when appropriate,
   and create the manifest. Resolve ambiguous fields before mutation.
3. Run `prepare`; verify duration/format, then follow the tested
   [private session bridge](references/session-upload.md) to `upload` when requested.
4. Apply requested background activation or mode, then verify once through the
   API and visible gallery. The CLI already checks prepared-resource bytes.
5. For library imports, confirm indexing in the UI. Preserve confirmed success
   if a later connectivity check fails; reconcile before any repeated mutation.

## Output Contract

Return source/range, destination, measured duration, file/resource ID, receipt
path and actual verification. For backgrounds, report `ready`, `active` and
effective selection mode separately; mention when another fixed video remains.

## References

- [Commands, manifests and recovery](references/workflow.md)
- [Video background fast path](references/video-backgrounds.md)
- [Private session bridge](references/session-upload.md)
