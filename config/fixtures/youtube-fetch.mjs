// Test-process preload: redirect only YouTube Data API calls to a local fixture.
import { env } from 'node:process'
import { URL } from 'node:url'

const origin = env.KARAOKE_E2E_YOUTUBE_ORIGIN
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin || '')) throw new Error('A local YouTube E2E fixture origin is required')
const originalFetch = globalThis.fetch
globalThis.fetch = (input, options) => {
  const url = new URL(input instanceof globalThis.Request ? input.url : String(input))
  if (url.origin === 'https://www.googleapis.com' && url.pathname.startsWith('/youtube/v3/')) {
    return originalFetch(`${origin}${url.pathname}${url.search}`, options)
  }
  return originalFetch(input, options)
}
