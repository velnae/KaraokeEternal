# YouTube search quota and video links

Both the participant search and the administrator's library accept a song title,
artist or YouTube video URL. A pasted video link uses `videos.list` directly and
keeps playback eligibility checks; format filters do not append keywords to URLs.

## When text search is unavailable

If the application reports **Se agotó el límite diario de búsquedas de YouTube**:

1. Paste a video's `youtube.com/watch?v=…` or `youtu.be/…` link into the same search
   field. Request the returned song as usual. This works while the separate video
   metadata quota remains available.
2. The administrator can inspect the project's `search.list` quota in Google Cloud
   and request an extension if normal venue usage exceeds the allocation.
3. Otherwise, wait for the provider's daily reset at midnight Pacific Time. The
   application cannot reset or increase this external quota.

Current official documentation specifies separate daily allocations of 100
`search.list` calls and 100 `videos.insert` calls, plus 10,000 units for other
endpoints. See Google's [quota calculator](https://developers.google.com/youtube/data/determine_quota_cost).

## Diagnosis and safeguards

The incident was confirmed against the configured provider: HTTP 429,
`rateLimitExceeded`, metric `youtube.googleapis.com/search_list`, limit
`defaultSearchListPerDayPerProject`, unit `1/d/{project}`, value `100`.
The previous adapter only recognized older `quotaExceeded`/`dailyLimitExceeded`
responses, which hid this cause behind a generic error on both interfaces.

The adapter now distinguishes daily search exhaustion, general quota exhaustion
and temporary rate limits. Successful search results (including empty results)
are cached for ten minutes, up to 200 entries per adapter instance. Concurrent
identical searches share one request. This cache contains public video metadata,
is shared across room searches, and is cleared by a process restart.

A quota/rate-limit response blocks new calls to that API resource for one minute;
there is no automatic retry loop. Cached results remain usable. A new song request
always resolves current video metadata again rather than trusting cached search
eligibility. Search API calls have five-second deadlines; direct request resolution
has a twenty-second deadline and uses the existing uncertain-receipt flow.

## Verification

- 421 unit/integration tests, typecheck, changed-file lint and both builds passed.
- `npm run test:library:e2e` passed all 11 scenario groups with an isolated provider
  fixture, including daily-quota errors in both interfaces, shared cache, cooldown
  and a mobile request from a pasted URL while text search was blocked.
- Quota/error and link screenshots were inspected at desktop and mobile sizes.
- A separate real-provider check confirmed the daily text-search error and a
  successful playable result for a pasted video URL. This was metadata validation,
  not a live playback or restored-text-search claim.
