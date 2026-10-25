# YouTube age and region preflight filters

**Status: implemented and verified on 2026-10-09.** Recommendation 1 now excludes age-restricted videos through shared normalization. The user confirmed player Internet egress is Peru and the loaded configuration is `PE`. The bounded live comparison did not exclude the reported video: its current API metadata has no age or region restriction.

## Goal and limits

Reduce requests for videos that metadata already identifies as unsuitable for our embedded player. This filters candidates; it does not unlock videos or guarantee that every remaining result will play.

The specific failure `Mm24HMrK6Js` has **not** been established as an age or region restriction. Do not promise that this change will exclude or fix that video until its current metadata is checked.

## Starting context

- Branch at planning time: `develop`, HEAD `6eb16de5`.
- There are unrelated uncommitted Cloudflare/development-cache changes and diagnostic documents. Inspect Git first and preserve them; do not reset, discard or include them in this work unit automatically.
- Canonical player URL: `https://karaoke.puyu.pe`. HTTP LAN origins previously disabled protected-media APIs and produced misleading 150 errors. A correct-origin test is essential.
- `Mm24HMrK6Js` (Zyzz - You Are My Angel) still failed with 150 under HTTPS, including privacy-enhanced embeds. Control `1IgOZaQqB58` (Maná - Labios Compartidos) played in the same HTTPS browser.
- Read `youtube-secure-context-diagnosis.md` and `cloudflare-development-tunnel.md` for evidence and runtime setup. Do not reconfigure the tunnel for this task.

## Implementation baseline

`server/SongSources/YouTubeSongSource.ts` already:

- searches with `type=video`, `videoEmbeddable=true`, `videoSyndicated=true`, `regionCode` and `safeSearch=moderate`;
- requests `videos.list` with `part=snippet,contentDetails,status`;
- checks embeddability, public/processed status and allowed/blocked countries;
- uses the same `normalizeVideo` function for search results and direct ID resolution;
- reads `KES_YOUTUBE_REGION`, defaulting to `PE`.

The baseline did not inspect `contentDetails.contentRating.ytRating`. The implemented check rejects `ytAgeRestricted`; missing/empty ratings remain eligible. The existing `contentDetails` request includes this metadata when available, so the new check needs no additional API request.

## Scope

Include the age filter, confirmation of the intended region and behavior tests for both search and request-time resolution.

Do not add manual approval, playback previews, rejection caches/blacklists, new providers, stream extraction, player-overlay changes or a broader UI redesign. Do not change `safeSearch` to `strict` as a substitute for a playability filter. Keep API keys server-side and respect credential-file access restrictions.

## Implementation steps

1. Extend the internal `YouTubeVideo.contentDetails` type with optional `contentRating: { ytRating?: string }`.
2. In `normalizeVideo`, include `contentRating?.ytRating !== 'ytAgeRestricted'` in the existing `isPlayable` conditions. Preserve every existing status/region check. Missing/empty rating must not reject otherwise eligible videos.
3. Keep search filtering and direct resolution consistent. Search must omit rejected items; `resolve(id)` must return the normalized item with `isPlayable: false`, allowing the existing `server/Queue/socket.ts` guard to reject it before insertion.
4. Verify the intended country for the **actual player**, including any VPN/exit node. Keep `PE` unless a mismatch is confirmed. Do not infer the country from the `.pe` hostname or Cloudflare edge location, and do not expose credentials when checking configuration.

## Automated acceptance cases

Extend `server/SongSources/YouTubeSongSource.test.ts` with otherwise valid video fixtures:

| Case | Expected |
| --- | --- |
| `ytRating: 'ytAgeRestricted'`, other checks pass | Absent from search; direct resolve has `isPlayable: false` |
| Missing `contentRating`, missing `ytRating`, or empty rating | Retain otherwise eligible video |
| Allowed-country list includes configured country | Retain if other checks pass |
| Allowed-country list excludes configured country, or is empty | Reject |
| Blocked-country list includes configured country | Reject |
| Blocked-country list excludes configured country, or is empty | Retain if other checks pass |
| No region restriction | Retain if other checks pass |
| Not embeddable, private, or not processed | Preserve existing rejection |

Also assert that search parameters, accepted-result order and credential exclusion remain correct. Use the existing queue socket tests to confirm an unplayable resolved item cannot be inserted, including an administrator path if coverage is missing. Do not change queue authorization or pending-limit behavior.

Suggested checks:

```sh
npm test -- server/SongSources/YouTubeSongSource.test.ts server/Queue/socket.test.ts
npx eslint server/SongSources/YouTubeSongSource.ts server/SongSources/YouTubeSongSource.test.ts
npx tsc -p config/tsconfig.server.json --noEmit
git diff --check
```

Then run the full suite when the focused checks pass. Earlier work documented an unrelated client `Player.tsx:173` TS2604; do not expand this filter task to fix that baseline.

## Bounded live experiment after implementation

1. Retrieve current metadata for `Mm24HMrK6Js` and control `1IgOZaQqB58`, preferably in one authorized server-side `videos.list` request. Use configured credentials opaquely; never print keys or request URLs containing them. Record only ID, status flags, `ytRating` and region restrictions.
2. Establish whether each sample actually has an age/region restriction. If neither does, say so; do not invent a diagnosis or silently add title/channel heuristics to exclude it.
3. Compare the same search query and region before/after the filter. Record whether the known rejected sample is listed, whether direct request-time validation rejects it, and whether the valid control remains available. Search ranking changes are not evidence of filtering: confirm the metadata predicate too.
4. Use an isolated instance/data set for request mutations. For real playback checks use the HTTPS origin and a visible, user-initiated official iframe; do not claim success from oEmbed, `onReady` or CUED alone. Do not take over the operational room player or modify its queue.
5. Report separately: **filter implemented correctly**, **the reported video was excluded or not**, and **remaining runtime playback failures**. If metadata passes but the iframe still rejects it, record that recommendation 1 does not solve that case.

### Evidence collected on 2026-10-09

Loaded configured credentials opaquely in a server-side Node/tsx process; no keys or credential-bearing URLs were printed. One `videos.list` request retrieved both samples. Both were public, processed and embeddable. Their returned metadata was replayed through the actual adapter's `resolve` method without queue mutations.

For each query below, the adapter made one live search and metadata request. The old predicate was evaluated against that same metadata response and compared with the new adapter output, avoiding search-ranking drift:

- `Zyzz You Are My Angel`, region `PE`: 10 eligible before, 10 after; `Mm24HMrK6Js` present in both; no age exclusions.
- `Maná Labios Compartidos`, region `PE`: 10 eligible before, 10 after; `1IgOZaQqB58` present in both; no age exclusions.

This verifies no reduction in these sampled results. Automated fixtures verify the rejection branch; the live samples do not contain an age-restricted candidate. HTTPS playback was not rerun in this implementation session; outcomes below are explicitly historical evidence from the linked diagnosis. No isolated user-initiated playback session was established, so current runtime playback remains unverified. The operational room/player and queue were not used for the experiment.

| ID | Age flag | Country / restriction | Listed before / after | Resolve eligible | HTTPS playback outcome |
| --- | --- | --- | --- | --- | --- |
| `Mm24HMrK6Js` | Absent | PE / none returned | Yes / yes | Yes | Prior HTTPS probe: error 150; not rerun |
| `1IgOZaQqB58` | Absent | PE / none returned | Yes / yes | Yes | Prior HTTPS probe: PLAYING; not rerun |

Verification results:

- Focused source/queue suite: **41/41 passed**.
- Full `npm test`: **221/221 passed in 28 files**.
- ESLint on both source files and `server/Queue/socket.test.ts`: passed.
- `npx tsc -p config/tsconfig.server.json --noEmit`: passed.
- `git diff --check`: passed.

Conclusion: the age filter is implemented and regression-tested, but recommendation 1 does not prevent the reported `Mm24HMrK6Js` failure with its current metadata. No additional rejection heuristic was introduced.

## Completion and rollback

- [x] Age rule implemented in the shared normalization path.
- [x] Effective country reviewed; user confirmed Peru and configuration remains PE.
- [x] Automated age/region and request-time regression checks pass, including administrator rejection.
- [x] Bounded live metadata/search comparison completed; fresh playback validation remains unverified as noted above.
- [x] Actual outcome and limitations saved in this document and Engram.

Rollback only the age predicate/type extension and its new tests; restore a changed region setting only if this task changed it. Preserve the earlier HTTPS/cache implementation and existing filters. Commit only if authorized in that session.

## Sources

- [Search filters: videoEmbeddable, videoSyndicated and regionCode](https://developers.google.com/youtube/v3/docs/search/list)
- [Video resource: contentRating, regionRestriction and embeddable](https://developers.google.com/youtube/v3/docs/videos)
- [YouTube Help: age-restricted videos and external embeds](https://support.google.com/youtube/answer/171780?hl=en)
