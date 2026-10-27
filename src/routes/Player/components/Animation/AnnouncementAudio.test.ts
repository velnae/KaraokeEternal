import { afterEach, expect, it, vi } from 'vitest'
import AnnouncementAudio from './AnnouncementAudio'
import type { AnimationClip } from '../../../../../shared/animation.js'
import { createHash } from 'node:crypto'

afterEach(() => vi.unstubAllGlobals())

it('releases a voice context only once', () => {
  const audio = new AnnouncementAudio()
  const context = { state: 'running', close: vi.fn(() => Promise.resolve()) }
  audio.context = context as unknown as AudioContext
  audio.close()
  audio.close()
  expect(context.close).toHaveBeenCalledTimes(1)
  expect(audio.context).toBeNull()
})

it('does not attempt to close an already closed voice context', () => {
  const audio = new AnnouncementAudio()
  const context = { state: 'closed', close: vi.fn() }
  audio.context = context as unknown as AudioContext
  audio.close()
  expect(context.close).not.toHaveBeenCalled()
  expect(audio.context).toBeNull()
})

it('settles active voice when disposal prevents the scheduled ended event', async () => {
  const audio = new AnnouncementAudio()
  const source = { connect: vi.fn(node => node), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null as (() => void) | null }
  const gain = { connect: vi.fn(), disconnect: vi.fn(), gain: {
    value: 0.5, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(),
  } }
  const context = { state: 'running', currentTime: 0, destination: {}, createBufferSource: () => source,
    createGain: () => gain, addEventListener: vi.fn(), removeEventListener: vi.fn(), close: vi.fn(() => Promise.resolve()) }
  audio.context = context as unknown as AudioContext
  audio.buffers.set('test', { duration: 4 } as AudioBuffer)
  const completion = audio.play('test', 0.5)
  audio.close()
  await expect(completion).resolves.toBe('STOPPED')
  expect(source.disconnect).toHaveBeenCalled()
  expect(context.close).toHaveBeenCalledTimes(1)
})

it('rejects an old preparation after closing instead of using a disposed context', async () => {
  const audio = new AnnouncementAudio()
  const context = { state: 'running', resume: vi.fn(() => Promise.resolve()), close: vi.fn(() => Promise.resolve()), decodeAudioData: vi.fn() }
  audio.context = context as unknown as AudioContext
  vi.stubGlobal('document', { baseURI: 'http://localhost/' })
  let finishFetch: (value: Response) => void
  const fetch = vi.fn(() => new Promise<Response>((resolve) => {
    finishFetch = resolve
  }))
  vi.stubGlobal('fetch', fetch)
  const pending = audio.unlock([{ id: 'test', checksum: 'test' } as AnimationClip])
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
  audio.close()
  finishFetch!(new Response('old audio'))
  await expect(pending).rejects.toThrow('cancelada')
  expect(context.decodeAudioData).not.toHaveBeenCalled()
  expect(audio.buffers.size).toBe(0)
})

it('bounds decoded memory and retains high-priority requested clips instead of the last loaded files', async () => {
  const audio = new AnnouncementAudio()
  const context = { state: 'running', resume: vi.fn(async () => {}), close: vi.fn(async () => {}), decodeAudioData: vi.fn(async () => ({ duration: 10, length: 441000, numberOfChannels: 2 })) }
  audio.context = context as unknown as AudioContext
  vi.stubGlobal('document', { baseURI: 'http://localhost/' })
  const clips = Array.from({ length: 24 }, (_, index) => ({ id: `voice-${index}`, durationMs: 10000, checksum: createHash('sha256').update(`voice-${index}`).digest('hex') } as AnimationClip))
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(url.split('/').pop())))
  await audio.unlock(clips)
  expect(audio.decodedBytes).toBeLessThanOrEqual(audio.maxDecodedBytes)
  expect(audio.buffers.has(clips[0].checksum)).toBe(true)
  expect(audio.buffers.has(clips[23].checksum)).toBe(false)
  await audio.unlock([clips[23], clips[0]])
  expect(audio.buffers.size).toBe(2)
  expect(audio.buffers.has(clips[23].checksum)).toBe(true)
  audio.close()
})
