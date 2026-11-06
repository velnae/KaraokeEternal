import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { open, close, db } from '../lib/Database.js'
import GreetingVoice, { voiceQuotaDay, voiceQuotaReset } from './GreetingVoice.js'
import { GreetingVoiceError, type GreetingVoiceProvider } from './GeminiGreetingTts.js'

let now: number
let provider: GreetingVoiceProvider
let voice: GreetingVoice
const signal = () => new AbortController().signal
beforeEach(() => {
  open({ file: ':memory:', ro: false })
  now = Date.parse('2026-11-03T20:00:00Z')
  provider = { configured: true, check: vi.fn().mockResolvedValue(undefined), generate: vi.fn().mockResolvedValue(Buffer.from('fixture')) }
  voice = new GreetingVoice(provider, () => now)
  voice.configure({ ...voice.config(), enabled: true })
})
afterEach(() => close())

it('shares a persistent rolling-minute budget across instances', async () => {
  for (let i = 0; i < 3; i++) await voice.generate('Hola', voice.profile(), signal())
  const restarted = new GreetingVoice(provider, () => now)
  await expect(restarted.generate('Otra sala', voice.profile(), signal())).rejects.toMatchObject({ kind: 'rate', attempted: false })
  expect(provider.generate).toHaveBeenCalledTimes(3)
  now += 60001
  await restarted.generate('Ahora sí', voice.profile(), signal())
  expect(restarted.snapshot().usage).toMatchObject({ day: 4, minute: 1 })
})

it('enforces daily limits until Pacific midnight and counts failed attempts', async () => {
  voice.configure({ ...voice.config(), requestsPerDay: 1 })
  vi.mocked(provider.generate).mockRejectedValueOnce(new GreetingVoiceError('Lost reply', 'uncertain'))
  await expect(voice.generate('Hola', voice.profile(), signal())).rejects.toMatchObject({ kind: 'uncertain' })
  now += 60001
  await expect(voice.generate('Hola', voice.profile(), signal())).rejects.toMatchObject({ kind: 'quota', attempted: false })
  now = voiceQuotaReset(now)
  await voice.generate('Nuevo día', voice.profile(), signal())
  expect(voice.snapshot().usage.day).toBe(1)
})

it.each([
  ['2026-03-08T09:00:00Z', '2026-03-09T07:00:00Z'],
  ['2026-11-01T08:00:00Z', '2026-11-02T08:00:00Z'],
])('handles the daylight-saving quota reset from %s', (date, reset) => {
  expect(new Date(voiceQuotaReset(Date.parse(date))).toISOString()).toBe(new Date(reset).toISOString())
  expect(voiceQuotaDay(Date.parse(reset) - 1)).not.toBe(voiceQuotaDay(Date.parse(reset)))
})

it('coordinates previews and queued greetings without consuming budget on overlap', async () => {
  let finish!: (value: Buffer) => void
  vi.mocked(provider.generate).mockImplementationOnce(() => new Promise((resolve) => {
    finish = resolve
  }))
  const pending = voice.generate('Prueba', voice.profile(), signal())
  await expect(voice.generate('Saludo', voice.profile(), signal())).rejects.toMatchObject({ kind: 'busy', attempted: false })
  expect(voice.snapshot().usage.day).toBe(1)
  finish(Buffer.from('audio'))
  await pending
})

it('persists remote quota exhaustion and does not clear it with a metadata check', async () => {
  vi.mocked(provider.generate).mockRejectedValueOnce(new GreetingVoiceError('Daily quota', 'quota'))
  await expect(voice.generate('Hola', voice.profile(), signal())).rejects.toThrow()
  const restarted = new GreetingVoice(provider, () => now)
  await restarted.check()
  await expect(restarted.generate('Hola', voice.profile(), signal())).rejects.toMatchObject({ kind: 'quota', attempted: false })
  expect(provider.generate).toHaveBeenCalledTimes(1)
})

it('pauses after an authentication failure until a successful access check', async () => {
  vi.mocked(provider.generate).mockRejectedValueOnce(new GreetingVoiceError('Fix key', 'auth'))
  await expect(voice.generate('Hola', voice.profile(), signal())).rejects.toThrow()
  expect(voice.snapshot().state).toBe('error')
  await expect(voice.generate('Hola', voice.profile(), signal())).rejects.toMatchObject({ kind: 'auth', attempted: false })
  await voice.check()
  await voice.generate('Hola', voice.profile(), signal())
})

it('rejects secrets, invalid values and stale settings without persisting them', () => {
  expect(() => voice.configure({ ...voice.config(), apiKey: 'secret' })).toThrow()
  expect(() => voice.configure({ ...voice.config(), model: 'not-a-tts-model' })).toThrow()
  expect(() => voice.configure({ ...voice.config(), requestsPerDay: 0 })).toThrow()
  expect(() => voice.configure({ ...voice.config(), revision: 0 })).toThrow('otra sesión')
  expect(JSON.stringify(voice.snapshot())).not.toContain('secret')
  expect(JSON.stringify(db.all('SELECT * FROM prefs'))).not.toContain('secret')
})

it('keeps the cache profile stable when only quotas or enablement change', () => {
  const profile = voice.profile()
  voice.configure({ ...voice.config(), requestsPerDay: 100, enabled: false })
  expect(voice.profile()).toEqual(profile)
  voice.configure({ ...voice.config(), voice: 'Kore' })
  expect(voice.profile()).not.toEqual(profile)
})

it('allows an explicit private preview before enabling automatic generation', async () => {
  voice.configure({ ...voice.config(), enabled: false })
  await expect(voice.generate('Saludo', voice.profile(), signal())).rejects.toMatchObject({ kind: 'disabled', attempted: false })
  await voice.generate('Prueba', voice.profile(), signal(), true)
  expect(voice.snapshot().usage.day).toBe(1)
  expect(voice.config().enabled).toBe(false)
})

it('applies call directions only after validating the shared base profile', async () => {
  const profile = voice.profile()
  await voice.generate('Desde la mesa siete,', profile, signal(), true, 'table')
  expect(vi.mocked(provider.generate).mock.calls[0][0]).toBe('Desde la mesa siete,')
  expect(vi.mocked(provider.generate).mock.calls[0][1].style).toContain('continuing intonation')
  await expect(voice.generate('Hola', { ...profile, style: 'override' }, signal(), true, 'intro')).rejects.toMatchObject({ attempted: false })
  expect(voice.snapshot().usage.day).toBe(1)
  await voice.generate('Saludo', profile, signal())
  expect(vi.mocked(provider.generate).mock.calls[1][1]).toEqual(profile)
})
