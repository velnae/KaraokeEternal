// Test-process preload: only a fixture key can be redirected to this local server.
import { env } from 'node:process'
import { URL } from 'node:url'

const origin = env.KARAOKE_E2E_GEMINI_ORIGIN
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin || '')) throw new Error('A local Gemini E2E fixture origin is required')
const originalFetch = globalThis.fetch
globalThis.fetch = (input, options) => {
  const url = new URL(input instanceof globalThis.Request ? input.url : String(input))
  if (url.origin === 'https://generativelanguage.googleapis.com') {
    const headers = new globalThis.Headers(options?.headers)
    if (headers.get('x-goog-api-key') !== 'fixture-only') throw new Error('Only the fixture key is allowed in isolated Gemini tests')
    return originalFetch(`${origin}${url.pathname}${url.search}`, options)
  }
  return originalFetch(input, options)
}
