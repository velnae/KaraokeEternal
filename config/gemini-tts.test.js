import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { main } from './gemini-tts.js'

// Complete mono PCM WAV fixture, not a provider call or a speech-quality sample.
const wav = Buffer.from('524946462800000057415645666d74201000000001000100c05d000080bb000002001000646174610400000000000000', 'hex')
const audioResponse = bytes => Response.json({
  candidates: [{ content: { parts: [
    { text: 'Audio follows.' },
    { inlineData: { mimeType: 'audio/wav', data: bytes.toString('base64') } },
  ] } }],
})

describe('standalone Gemini TTS script', () => {
  let directory, output, fetchMock

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'gemini-tts-'))
    output = join(directory, 'welcome.wav')
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('GEMINI_API_KEY', 'test-key')
    vi.stubEnv('GOOGLE_API_KEY', '')
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    await rm(directory, { recursive: true, force: true })
  })

  it('sends the Spanish transcript separately from delivery instructions and preserves the returned WAV', async () => {
    fetchMock.mockResolvedValue(audioResponse(wav))
    await main(['--output', output])

    const [url, request] = fetchMock.mock.calls[0]
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash-lite-tts:generateContent')
    expect(request.headers['x-goog-api-key']).toBe('test-key')
    const body = JSON.parse(request.body)
    expect(body.contents[0].parts[0]).toEqual({
      text: '¡Hola! ... ¡Bienvenidos al karaoke! Esta noche, ¡llamas y ñustas nos acompañan! ¿Qué te parece?',
      speech_metadata: { style: expect.stringContaining('Peruvian accent') },
    })
    expect(body.generationConfig.responseFormat.audio.mimeType).toBe('AUDIO_WAV')
    expect(body.generationConfig.speechConfig.voiceConfig).toEqual({ voice: 'Puck' })
    expect(await readFile(output)).toEqual(wav)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('accepts a custom transcript, voice, style and nested output with the alternate API key', async () => {
    vi.stubEnv('GEMINI_API_KEY', '')
    vi.stubEnv('GOOGLE_API_KEY', 'alternate-test-key')
    fetchMock.mockResolvedValue(audioResponse(wav))
    const nested = join(directory, 'nested', 'custom.wav')
    await main(['--text', '¡Buenas noches!', '--voice', 'Kore', '--style', 'Calm Latin American Spanish.', '--output', nested])

    const request = fetchMock.mock.calls[0][1]
    expect(request.headers['x-goog-api-key']).toBe('alternate-test-key')
    const body = JSON.parse(request.body)
    expect(body.contents[0].parts[0]).toEqual({ text: '¡Buenas noches!', speech_metadata: { style: 'Calm Latin American Spanish.' } })
    expect(body.generationConfig.speechConfig.voiceConfig.voice).toBe('Kore')
    expect(await readFile(nested)).toEqual(wav)
  })

  it('allows help without a key and fails before sending a request when the key is missing', async () => {
    vi.stubEnv('GEMINI_API_KEY', '')
    await main(['--help'])
    await expect(main(['--output', output])).rejects.toThrow('Set GEMINI_API_KEY')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(await readdir(directory)).toEqual([])
  })

  it.each([
    ['quota error', () => Response.json({ error: { message: 'Quota exceeded' } }, { status: 429 }), 'Gemini HTTP 429: Quota exceeded'],
    ['blocked prompt', () => Response.json({ promptFeedback: { blockReason: 'SAFETY' } }), 'Gemini returned no audio: SAFETY'],
    ['unexpected raw PCM', () => audioResponse(Buffer.alloc(100)), 'Gemini did not return the requested WAV audio'],
  ])('reports %s without writing an invalid audio file', async (_name, response, message) => {
    fetchMock.mockResolvedValue(response())
    await expect(main(['--output', output])).rejects.toThrow(message)
    expect(await readdir(directory)).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
