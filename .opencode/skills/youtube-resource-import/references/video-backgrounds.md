# Video backgrounds: short operational path

Import into the persistent room catalog, then apply the user's requested state.
Open `/admin/settings/animator?view=background` on the project HTTPS URL.

## 1. One live preflight

In one browser evaluation, fetch `api/user`, `api/rooms` and
`api/animation/background/` against `document.baseURI`. Check HTTP status and
JSON content type before parsing. Return only administrator status, current room
ID/name, background settings, capability and video IDs/titles/states.

- Use the authenticated current room unless another room was requested. Ask only
  if room identity is missing or conflicting; do not ask again for a confirmed room.
- Read `overview.videos`, `settings` and `capability`; don't assume old single-video
  retention rules. Catalog items persist until explicitly deleted.
- Reuse a matching saved receipt before creating another request ID.
- If no admin session exists, ask the user to sign in. Do not mint tokens.

## 2. Download the interval, not the entire long source

For an explicitly short range, use `yt-dlp --download-sections` first. Full-source
download is useful only when deliberately reusing it for multiple cuts.
For a background, download video only: its audio will not be used.

```bash
yt-dlp --ignore-config --no-playlist --no-progress --no-overwrites \
  --socket-timeout 20 --retries 1 \
  -f 'bestvideo[height<=1080]/best[height<=1080]' \
  --download-sections '*0-30' --downloader-args 'ffmpeg:-loglevel error' \
  -o '.atl/media-imports/VIDEO_ID-000-030-source.%(ext)s' -- 'YOUTUBE_URL'
```

Substitute the confirmed URL/range and use the returned file extension. Reuse the
file only with a matching provenance receipt; `--no-overwrites` alone is not proof.
Create a sidecar with original URL/title, requested original timestamps and local
fragment path. FFmpeg may fetch extra segments or retain boundary frames; the
following local conversion determines the final duration.
For nonzero starts requiring frame-accurate cuts, use
`--force-keyframes-at-cuts` and verify the fragment's start before preparation.

Run the existing CLI `prepare` with `sourceFile`, `destination: "background"`,
the confirmed `roomId`, a descriptive title and local `start: 0`, `end: 30`.
For another interval, local end is the requested interval length, not its original
end timestamp. Do not give the original URL to `prepare` after fetching the fragment.

The CLI creates silent H.264 MP4, at most 1080p/30 fps. Background limits are
30 seconds and 40 MiB. Check the returned duration/size; preserve an exact
30-second request rather than silently reducing it. Upload via the
[private session bridge](session-upload.md), which returns the resource ID and
verifies the prepared bytes/checksum.

## 3. Apply the requested operation

Use same-origin authenticated requests; recheck the expected room before mutation.
All paths below are relative to `api/animation/background/`.

| User intent | Operation after ready upload |
| --- | --- |
| Import/save another background | Leave the new catalog item inactive. |
| “Déjalo activo”, “agregalo activo” | `PATCH videos/ID` with `{ "active": true }`; preserve room selection/mode. |
| “Usalo como fondo fijo”, “seleccioná este” | `PUT ./` with `mode: "single"`, new `videoId`, latest `revision` and existing `dimOpacity`. This also activates the item. |
| “Rotá entre todos los activos” | Activate the requested item if needed; `PUT ./` with `mode: "all"`, `videoId: null`, latest `revision` and existing `dimOpacity`. |

Missing `mode` means fixed/single behavior. An active catalog item is not
necessarily the selected background. Do not infer rotation from “un video más”.
Preserve unrelated settings and use a fresh revision for PUT. On 409, read current
state and resolve the conflict rather than blindly overwriting another operator.

## 4. Verify once and finish

Read the overview after mutation, confirm the target is `ready` and its requested
`active`/selection state, then check the gallery row in the admin UI. Save an
activation receipt with resource ID, room, measured duration/size and actual mode.
No forced public playback is needed. Avoid redundant full decodes/checksum downloads:
the preparation and upload CLI already validate those boundaries.

If a later request fails, retain the last confirmed state and report the outage
separately. Do not restart services or repeat successful mutations to fix a recheck.

## Contracts

- [Background routes](../../../../server/TransitionVideo/router.ts)
- [Activation and settings](../../../../server/TransitionVideo/Store.ts)
- [Limits and modes](../../../../shared/transitionVideo.ts)
