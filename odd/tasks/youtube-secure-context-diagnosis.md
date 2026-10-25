# YouTube error 150 on an insecure LAN origin

**Finding**: The seven videos reported failing with IFrame error 150 started real playback from `http://localhost:3000` in isolated browser probes. HTTP on the LAN address makes the parent and YouTube iframe insecure contexts, leaving protected-media APIs unavailable. The generic owner-restriction log message was not a sufficient diagnosis for these cases.

**Deployment follow-up**: `https://karaoke.puyu.pe` is now the preferred shared address for player and guests. A dedicated development tunnel was subsequently installed and verified; see `cloudflare-development-tunnel.md`. The localhost procedure below remains an alternative when using the server computer directly.

## Operational solution

On the computer that runs Karaoke Eternal:

1. Close the existing player tab opened through the LAN IP so it releases the room's player slot.
2. Open `http://localhost:3000`, sign in as the administrator and open the player there.
3. Add the failed tracks again; FAILED queue entries do not automatically become eligible after changing origin.
4. Participants can continue requesting songs through the LAN address. In this installation it is `http://192.168.1.94:3000`.

For a player on another computer/TV, use HTTPS with a certificate trusted by that device. `localhost` always means the device where the browser is running, not a remote karaoke server. Merely changing the iframe URL is insufficient: its parent must also be a secure context.

**QR limitation**: `PlayerQR.tsx` currently builds the invitation URL from the player's browser location. A localhost player consequently creates a localhost QR, unsuitable for phones. Until a separately configurable guest URL is implemented, share the LAN URL directly, or use one trusted HTTPS URL for both player and guests. No such QR/configuration change or HTTPS deployment was performed in this diagnosis.

## Evidence collected on 2026-10-09

- Branch `develop` at `6eb16de5`, clean before this diagnostic document.
- Live development process 3980871, tmux pane `%5`. File logging is disabled by default in development and `server.log` was empty. Captured only sanitized failure and startup lines from that pane.
- Eleven accepted playback-failure logs, all IFrame **150**, across seven IDs, queue items 8–20. Readonly SQLite query confirmed FAILED states and existing PLAYED entries. PLAYED alone does not prove full playback because manual Next can also settle an item that way.
- Player requests/connections were present from the server's own LAN IP. `/player` response had no referrer-policy override; the isolated LAN iframe request included `Referer: http://192.168.1.94:3000/`.
- No application login, Socket.IO player connection, actual room mutation, API key read or paid Data API search was used for playback probes. A separate browser context intercepted only a diagnostic page URL and served minimal HTML containing the real public YouTube IFrame API, matching the application's player parameters. Actual YouTube media was loaded muted.

| Video ID | Description | Recorded failure | Isolated localhost result |
| --- | --- | --- | --- |
| `1IgOZaQqB58` | Maná — Labios Compartidos | 150 | PLAYING; provider status OK |
| `ue0RP3C1Brg` | AIRBAG — Nunca lo olvides | 150 | PLAYING; provider status OK |
| `U5TiuzOkJEY` | Maná — Rayando el sol, Party Tyme karaoke | 150 | PLAYING; provider status OK |
| `7i82UQZOQPE` | Akapellah Como Mario karaoke | 150 | PLAYING; time advanced past 1s |
| `rClsc05_eU0` | Bailando, English official video upload | 150 | PLAYING; time advanced past 1s |
| `Pgum6OT_VH8` | Muse — Starlight | 150 | PLAYING; time advanced past 1s |
| `EPbhDrAwwcU` | Maná — Oye mi amor karaoke | 150 | PLAYING; time advanced past 1s |

The first three were also directly compared under both origins in fresh contexts:

| Check | HTTP LAN IP | HTTP localhost |
| --- | --- | --- |
| Top document `isSecureContext` | false | true |
| YouTube iframe `isSecureContext` | false | true |
| Iframe `navigator.requestMediaKeySystemAccess` | undefined | function |
| Same three videos | error 150 | PLAYING |

Control videos `uHFqL-7pe_0` and `c1bwQWnd-Tc` played under the HTTP LAN origin. This explains why some tracks work while protected-media-dependent ones fail. The tests establish playback startup in this browser, not complete-song playback, physical audio output or universal availability across all YouTube videos/devices.

## Interpretation and follow-up

- Current preflight filters (`videoEmbeddable`, public/processed status, region) cannot detect whether the actual player's browser exposes EME. oEmbed returning iframe metadata also does not establish runtime compatibility.
- Genuine embedding/rights restrictions can still occur in a secure context; do not classify every 150 as either DRM or owner rejection without context evidence.
- Potential application follow-up: detect an insecure player origin and show a concise actionable notice; decouple QR guest base URL from playback origin; include safe capability booleans in diagnostic logging. These are not implemented here.
- Separate from this error, admin YouTube `+` currently uses PARTICIPANT origin; the local-song UI has HOUSE/OPERATOR actions. This does not cause error 150.

## Sources

- [MDN: secure contexts and iframe ancestry](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Secure_Contexts)
- [MDN: requestMediaKeySystemAccess requires a secure context](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/requestMediaKeySystemAccess)
- [YouTube IFrame API error definitions](https://developers.google.com/youtube/iframe_api_reference#onError)

## Relevant code

- `src/routes/Player/components/Player/YouTubePlayer/YouTubePlayer.tsx` — iframe construction and error forwarding.
- `server/Player/socket.ts` — accepted failure logging and generic code mapping.
- `server/SongSources/YouTubeSongSource.ts` — preflight filtering/resolution.
- `src/routes/Player/components/PlayerQR/PlayerQR.tsx` — current invitation URL derivation.

## Follow-up: a video-specific rejection after HTTPS deployment

User reported queue item 21, `Mm24HMrK6Js`, at 2026-10-09T18:02:37Z. Readonly queue inspection identified **Zyzz - You Are My Angel (HD)** and FAILED status; item 22 was already PLAYING, consistent with the existing failure-and-advance behavior.

Controlled, muted standalone IFrame probes found:

| Probe | Result |
| --- | --- |
| `Mm24HMrK6Js` on `https://karaoke.puyu.pe` | IFrame 150, secure top/child contexts and EME API available |
| Same video on HTTP LAN IP | IFrame 150, insecure context |
| Control `1IgOZaQqB58` in the same HTTPS browser | PLAYING; provider response OK |
| Explicit referrer policy and encrypted-media permission on normal YouTube embed | 150 |
| Official privacy-enhanced `youtube-nocookie.com` embed on HTTPS | 150 |

oEmbed still returned the video's title and iframe metadata. The exact underlying rights/region/account restriction was not exposed by the tested player; only the video-specific embedded-playback refusal is established. Do not attribute this new case to the already corrected HTTP/EME issue, or assume a tunnel setting can grant playback permission.

### Prevention proposal, not implemented

- For house music, curate videos through a visible playback preview before approving them. A metadata flag or a CUED/ready event alone is not playback validation.
- For open requests, retain explicit failed state and automatic advancement; offer an alternate version and remember recent rejections per room/player context with expiry and manual retry, rather than permanently blacklisting IDs globally.
- If every request must be checked before it enters the playable queue, that adds a validation/approval step and changes the current fast request flow. Obtain the user's choice before imposing this workflow.
- Continue using HTTPS on the actual player, not just on the requesting phone. Existing logs do not record the player's origin/capabilities, so a new request arriving through the tunnel does not prove that an older player tab migrated.

No application source, room settings, credentials or live playback state were changed in this follow-up; probes did not connect to the application's Socket.IO player namespace.
