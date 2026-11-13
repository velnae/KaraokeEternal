import { describe, expect, it, vi } from 'vitest'
import GeminiGreetingTts from './Gemini.js'
import { loadGreetingVoiceProfile } from '../Greetings/voiceProfile.js'
import { defaultGreetingVoiceConfig } from '../../shared/greetingVoice.js'
import { createGemini } from './index.js'

const profile = loadGreetingVoiceProfile(defaultGreetingVoiceConfig)
const wav = Buffer.from('524946462800000057415645666d74201000000001000100c05d000080bb000002001000646174610400000000000000', 'hex')
const audio = () => Response.json({ candidates: [{ content: { parts: [{ text: 'Metadata' }, { inlineData: { data: wav.toString('base64') } }] } }] })

describe('Gemini greeting provider', () => {
  it('keeps the transcript separate from style and preserves complete WAV bytes', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(audio())
    const provider = new GeminiGreetingTts('private-key', request)
    expect(await provider.generate('¡Llamas y ñustas!', profile, new AbortController().signal)).toEqual(wav)
    const [url, options] = request.mock.calls[0]
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash-lite-tts:generateContent')
    const body = JSON.parse(options!.body as string)
    expect(body.contents[0].parts).toEqual([{ text: '¡Llamas y ñustas!', speech_metadata: { style: profile.style } }])
    expect(body.generationConfig.speechConfig.voiceConfig).toEqual({ voice: 'Puck' })
    expect(body.generationConfig.responseFormat.audio).toEqual({ mimeType: 'AUDIO_WAV', sampleRate: 24000 })
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('checks model metadata without generating audio', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ name: `models/${profile.model}`, supportedGenerationMethods: ['generateContent'] }))
    await new GeminiGreetingTts('key', request).check(profile.model)
    expect(request.mock.calls[0][0]).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${profile.model}`)
    expect(request.mock.calls[0][1]?.body).toBeUndefined()
  })

  it.each([
    [401, { message: 'private-key private greeting' }, 'auth'],
    [403, {}, 'auth'],
    [402, {}, 'auth'],
    [429, { details: [{ violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }] }, 'quota'],
    [429, { details: [{ retryDelay: '3s' }] }, 'rate'],
    [400, {}, 'invalid'],
    [503, {}, 'uncertain'],
  ])('classifies HTTP %s without exposing provider messages or retrying', async (status, error, kind) => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error }, { status }))
    const result = new GeminiGreetingTts('private-key', request).generate('private greeting', profile, new AbortController().signal)
    await expect(result).rejects.toMatchObject({ kind })
    await expect(result).rejects.not.toThrow('private-key')
    await expect(result).rejects.not.toThrow('private greeting')
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('honors Retry-After on transient rate limits', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}, { status: 429, headers: { 'Retry-After': '90' } }))
    const now = Date.now()
    const error = await new GeminiGreetingTts('key', request).generate('Hola', profile, new AbortController().signal).catch(error => error)
    expect(error.retryAt).toBeGreaterThanOrEqual(now + 90000)
  })

  it.each([
    () => Response.json({ promptFeedback: { blockReason: 'SAFETY' } }),
    () => Response.json({ candidates: [{ content: { parts: [{ inlineData: { data: Buffer.alloc(100).toString('base64') } }] } }] }),
  ])('rejects missing or invalid audio', async (response) => {
    await expect(new GeminiGreetingTts('key', vi.fn().mockResolvedValue(response())).generate('Hola', profile, new AbortController().signal)).rejects.toMatchObject({ kind: 'invalid' })
  })

  it('treats a lost response as uncertain without automatic retry', async () => {
    const request = vi.fn<typeof fetch>().mockRejectedValue(new Error('network private-key'))
    await expect(new GeminiGreetingTts('key', request).generate('Hola', profile, new AbortController().signal)).rejects.toMatchObject({ kind: 'uncertain' })
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('does not send when cancelled before generation', async () => {
    const request = vi.fn<typeof fetch>()
    const controller = new AbortController()
    controller.abort()
    await expect(new GeminiGreetingTts('key', request).generate('Hola', profile, controller.signal)).rejects.toThrow()
    expect(request).not.toHaveBeenCalled()
  })

  it('uses one configured transport for model checks, paginated voices, speech and structured text', async () => {
    const request = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      const target = new URL(String(url))
      if (target.pathname.endsWith('/voices')) {
        return Response.json(target.searchParams.has('page_token')
          ? { voices: [{ id: 'Sulafat', display_name: 'Sulafat', accent: 'Latinoamericano' }] }
          : { voices: [], next_page_token: 'second-page' })
      }
      if (target.pathname.endsWith('/text-model:generateContent')) return Response.json({ candidates: [{ content: { parts: [{ text: '{"script":"Hola"}' }] } }] })
      if (target.pathname.endsWith(':generateContent')) return audio()
      return Response.json({ name: `models/${profile.model}`, supportedGenerationMethods: ['generateContent'] })
    })
    const provider = createGemini({ key: 'private-key', baseUrl: 'https://fixture.test' }, request)
    expect(await provider.listVoices(profile.model, 'es-PE', 'Sulafat')).toEqual([{ voiceId: 'Sulafat', name: 'Sulafat · Latinoamericano' }])
    expect(await provider.generate('Hola', profile, new AbortController().signal)).toEqual(wav)
    const input = { contents: [{ parts: [{ text: 'Write a greeting' }] }], generationConfig: { responseMimeType: 'application/json' } }
    expect(await provider.generateText('text-model', input, new AbortController().signal)).toBe('{"script":"Hola"}')
    expect(request).toHaveBeenCalledTimes(5)
    for (const [url, options] of request.mock.calls) {
      expect(new URL(String(url)).origin).toBe('https://fixture.test')
      expect(new Headers(options?.headers).get('x-goog-api-key')).toBe('private-key')
    }
    expect(String(request.mock.calls[2][0])).toContain('page_token=second-page')
    expect(JSON.parse(request.mock.calls[4][1]!.body as string)).toEqual(input)
  })

  it('bounds structured text responses and does not repeat an uncertain text request', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('x'.repeat(65537)))
    const provider = createGemini({ key: 'private-key' }, request)
    await expect(provider.generateText('text-model', {}, new AbortController().signal)).rejects.toMatchObject({ kind: 'invalid' })
    request.mockRejectedValueOnce(new Error('private-key private prompt'))
    await expect(provider.generateText('text-model', {}, new AbortController().signal)).rejects.toMatchObject({ kind: 'uncertain' })
    expect(request).toHaveBeenCalledTimes(2)
  })
})
