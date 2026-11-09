import { afterEach, expect, it, vi } from 'vitest'
import { listBirthdayVoices, speakGeminiBirthday } from './gemini.js'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})
it('checks model and voice then sends the literal transcript separately from interpretation', async () => {
  vi.stubEnv('KES_GEMINI_API_KEY', 'fixture-key')
  vi.stubEnv('KES_GEMINI_BASE_URL', 'https://fixture.test')
  const calls: { url: string, body?: Record<string, unknown> }[] = []
  const bytes = Buffer.alloc(100)
  bytes.write('RIFF', 0)
  bytes.write('WAVE', 8)
  vi.stubGlobal('fetch', vi.fn(async (url, options) => {
    calls.push({ url: String(url), body: options?.body ? JSON.parse(String(options.body)) : undefined })
    if (String(url).includes('/voices?')) return Response.json({ voices: [{ id: 'Sulafat', display_name: 'Sulafat', accent: 'Latinoamericano' }] })
    if (String(url).endsWith('generateContent')) return Response.json({ candidates: [{ content: { parts: [{ inlineData: { data: bytes.toString('base64') } }] } }] })
    return Response.json({ name: 'models/gemini-3.8-flash-tts', supportedGenerationMethods: ['generateContent'] })
  }))
  const profile = { provider: 'gemini' as const, model: 'gemini-3.8-flash-tts', voice: 'Sulafat', style: 'Cálida y alegre.', processingRevision: 1 }
  expect(await speakGeminiBirthday('¡Feliz cumpleaños, María!', profile, new AbortController().signal)).toEqual(bytes)
  const body = calls.find(call => call.url.endsWith('generateContent'))!.body as { contents: { parts: { text: string, speech_metadata: { style: string } }[] }[], generationConfig: { speechConfig: { voiceConfig: { voice: string } } } }
  expect(body.contents[0].parts[0]).toEqual({ text: '¡Feliz cumpleaños, María!', speech_metadata: { style: profile.style } })
  expect(body.generationConfig.speechConfig.voiceConfig.voice).toBe('Sulafat')
  expect((await listBirthdayVoices(profile.model, 'es-PE'))[0].voiceId).toBe('Sulafat')
  expect(calls.at(-1)!.url).toContain('language_code=es-PE')
  await expect(speakGeminiBirthday('Test', { ...profile, voice: 'missing' }, new AbortController().signal)).rejects.toThrow('no está disponible')
})
