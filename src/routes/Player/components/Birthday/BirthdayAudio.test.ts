import { afterEach, expect, it, vi } from 'vitest'
import { BirthdayAudio } from './BirthdayAudio'
import type { BirthdayAsset } from 'shared/birthdays'

afterEach(() => vi.unstubAllGlobals())

async function fixture () {
  const bytes = new TextEncoder().encode('prepared audio')
  const checksum = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('')
  vi.stubGlobal('document', { baseURI: 'https://karaoke.test/' })
  vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes)))
  const gain = { gain: { value: 1, setValueAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() }
  const source = { buffer: null as AudioBuffer | null, onended: null as (() => void) | null, connect: vi.fn(() => gain), start: vi.fn(), stop: vi.fn(), disconnect: vi.fn() }
  const context = { currentTime: 0, state: 'running', destination: {}, decodeAudioData: vi.fn(async () => ({ duration: 30 })), createGain: () => gain,
    createBufferSource: () => source, addEventListener: vi.fn(), removeEventListener: vi.fn() }
  const asset: BirthdayAsset = { id: 'voice', kind: 'greeting', title: 'Birthday', durationMs: 30000, checksum, url: 'api/birthdays/assets/voice' }
  const audio = new BirthdayAudio(context as unknown as AudioContext)
  const abort = new AbortController()
  await audio.prepare([asset], abort.signal)
  return { audio, source, context, gain, asset, abort }
}

it('uses a renewable audio-clock deadline and cannot revive an expired source', async () => {
  const { audio, source, context, asset, abort } = await fixture()
  audio.permitFor(10000)
  const playing = audio.play(asset, 0.5, abort.signal)
  await vi.waitFor(() => expect(source.start).toHaveBeenCalledOnce())
  expect(source.stop).toHaveBeenLastCalledWith(10)
  context.currentTime = 4
  audio.permitFor(10000)
  expect(source.stop).toHaveBeenLastCalledWith(14)
  // Even if JS wakes after the buffer's nominal duration, the scheduled cut
  // remains an interruption, not a successful natural end.
  context.currentTime = 35
  audio.permitFor(15000)
  expect(source.stop).toHaveBeenLastCalledWith(14)
  const rejected = expect(playing).rejects.toThrow('permiso de audio venció')
  source.onended!()
  await rejected
  expect(source.disconnect).toHaveBeenCalledOnce()
})

it('completes natural playback once and applies live volume without restarting', async () => {
  const { audio, source, context, gain, asset, abort } = await fixture()
  audio.permitFor(40000)
  const playing = audio.play(asset, 0.5, abort.signal)
  await vi.waitFor(() => expect(source.start).toHaveBeenCalledOnce())
  context.currentTime = 5
  audio.volume(0.35)
  expect(gain.gain.setValueAtTime).toHaveBeenCalledWith(0.35, 5)
  context.currentTime = 30
  source.onended!()
  await playing
  expect(source.start).toHaveBeenCalledOnce()
  expect(source.disconnect).toHaveBeenCalledOnce()
  expect(source.onended).toBeNull()
})
