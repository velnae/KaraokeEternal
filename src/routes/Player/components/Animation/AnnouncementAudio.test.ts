import { afterEach, expect, it, vi } from 'vitest'
import AnnouncementAudio from './AnnouncementAudio'
import type { AnimationClip } from '../../../../../shared/animation.js'
import { createHash } from 'node:crypto'
import type { GreetingAsset } from '../../../../../shared/greetings.js'
import { playbackTraceSnapshot } from '../../../../lib/playbackTrace'

afterEach(() => vi.unstubAllGlobals())

it('retains the call and its fallbacks alongside greetings under catalog memory pressure', async () => {
  const audio = new AnnouncementAudio()
  audio.context = { state: 'running', close: async () => {}, decodeAudioData: async () => ({ duration: 10, length: 441000, numberOfChannels: 2 }) } as unknown as AudioContext
  vi.stubGlobal('document', { baseURI: 'http://localhost/karaoke/' })
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(url.split('/').pop())))
  const calls = Array.from({ length: 3 }, (_, index) => ({ id: `call-${index}`, role: 'call', url: `api/calls/call-${index}`,
    checksum: createHash('sha256').update(`call-${index}`).digest('hex'), durationMs: 10000, kind: 'voice' } as GreetingAsset))
  const greeting = { id: 'greeting', role: 'greeting', url: 'api/greeting', checksum: createHash('sha256').update('greeting').digest('hex'), durationMs: 10000, kind: 'voice' } as GreetingAsset
  const catalog = Array.from({ length: 24 }, (_, index) => ({ id: `catalog-${index}`, durationMs: 10000,
    checksum: createHash('sha256').update(`catalog-${index}`).digest('hex'), kind: 'voice' } as AnimationClip))
  await audio.prepare(catalog)
  await audio.prepareGreetingAssets([...calls, greeting])
  await audio.prepare(catalog)
  expect(audio.decodedBytes).toBeLessThanOrEqual(audio.maxDecodedBytes)
  expect([...calls, greeting].every(asset => audio.buffers.has(asset.checksum))).toBe(true)
  expect(audio.readyChecksums.slice(0, 3)).toEqual(calls.map(asset => asset.checksum))
  await audio.prepareGreetingAssets([])
  expect(calls.some(asset => audio.buffers.has(asset.checksum))).toBe(false)
  audio.close()
})

it('preloads a private twenty-second greeting independently of catalog refresh', async () => {
  const audio = new AnnouncementAudio()
  audio.context = { state: 'running', close: async () => {}, decodeAudioData: async () => ({ duration: 20, length: 480000, numberOfChannels: 1 }) } as unknown as AudioContext
  vi.stubGlobal('document', { baseURI: 'http://localhost/karaoke/' })
  vi.stubGlobal('fetch', vi.fn(async () => new Response('private voice')))
  const checksum = createHash('sha256').update('private voice').digest('hex')
  const privateClip = { id: 'greeting', role: 'greeting', url: 'api/greetings/1/audio', checksum, durationMs: 20000, kind: 'voice' } as GreetingAsset
  expect(await audio.prepareGreetingAssets([privateClip])).toEqual([checksum])
  await audio.prepare([])
  expect(audio.buffers.has(checksum)).toBe(true)
  await audio.prepareGreetingAssets([])
  expect(audio.buffers.has(checksum)).toBe(false)
  audio.close()
})

it('mixes a separate quiet bed and stops both sources without extending the hard deadline', async () => {
  const audio = new AnnouncementAudio()
  const sources: Array<{ connect: ReturnType<typeof vi.fn>, disconnect: ReturnType<typeof vi.fn>, start: ReturnType<typeof vi.fn>, stop: ReturnType<typeof vi.fn>, onended: (() => void) | null }> = []
  const gains: Array<{ connect: ReturnType<typeof vi.fn>, disconnect: ReturnType<typeof vi.fn>, gain: { value: number, cancelScheduledValues: ReturnType<typeof vi.fn>, setValueAtTime: ReturnType<typeof vi.fn>, linearRampToValueAtTime: ReturnType<typeof vi.fn> } }> = []
  const context = { state: 'running', currentTime: 0, destination: {}, addEventListener: vi.fn(), removeEventListener: vi.fn(), close: async () => {},
    createBufferSource: () => {
      const source = { connect: vi.fn(node => node), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null as (() => void) | null }
      sources.push(source)
      return source
    },
    createGain: () => {
      const gain = { connect: vi.fn(), disconnect: vi.fn(), gain: { value: 0.1, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() } }
      gains.push(gain)
      return gain
    },
  }
  audio.context = context as unknown as AudioContext
  audio.buffers.set('voice', { duration: 4 } as AudioBuffer)
  audio.buffers.set('bed', { duration: 35 } as AudioBuffer)
  const voice = audio.play('voice', 0.5)
  const bed = audio.playBed('bed', 0.1, 25000)
  expect(sources).toHaveLength(2)
  expect(sources[1].stop).toHaveBeenLastCalledWith(25)
  expect(gains[1].gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.1, 0.2)
  context.currentTime = 1.25
  audio.stopForeground('socket-disconnected')
  sources[0].onended!()
  await expect(voice).resolves.toBe('STOPPED')
  const ended = playbackTraceSnapshot().events.reverse().find(event => event.event === 'audio-finish' && event.channelId === audio.traceChannelId)
  expect(ended).toMatchObject({ reason: 'socket-disconnected', state: 'STOPPED', audioElapsedMs: 1250 })
  expect(audio.hasBed).toBe(true)
  expect(sources[1].stop).toHaveBeenCalledTimes(1)
  context.currentTime = 24.9
  const stopping = audio.stopBed(500)
  expect(sources[1].stop).toHaveBeenLastCalledWith(25)
  audio.close()
  await expect(voice).resolves.toBe('STOPPED')
  await expect(bed).resolves.toBe('STOPPED')
  await expect(stopping).resolves.toBe('STOPPED')
  expect(audio.hasBed).toBe(false)
  expect(sources.every(source => source.disconnect.mock.calls.length > 0)).toBe(true)
})

it('prepares while autoplay is blocked and resumes the same decoded audio after a gesture', async () => {
  const audio = new AnnouncementAudio()
  const context = { state: 'suspended', resume: vi.fn(async () => {
    context.state = 'running'
  }), close: async () => {},
  decodeAudioData: vi.fn(async () => ({ duration: 1, length: 44100, numberOfChannels: 1 })) }
  audio.context = context as unknown as AudioContext
  vi.stubGlobal('document', { baseURI: 'http://localhost/' })
  vi.stubGlobal('fetch', vi.fn(async () => new Response('voice')))
  const checksum = createHash('sha256').update('voice').digest('hex')
  await expect(audio.prepare([{ id: 'voice', checksum, durationMs: 1000, kind: 'voice' } as AnimationClip])).resolves.toEqual([checksum])
  expect(context.resume).not.toHaveBeenCalled()
  expect(audio.ready).toBe(false)
  expect(() => audio.play(checksum, 0.5)).toThrow('no está disponible')
  await audio.resume()
  expect(audio.ready).toBe(true)
  expect(context.decodeAudioData).toHaveBeenCalledTimes(1)
  audio.close()
})

it('fades a curtain bed completely and blocks every ambience source until music actually starts', async () => {
  const audio = new AnnouncementAudio()
  const source = { connect: vi.fn(node => node), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null as (() => void) | null }
  const gain = { connect: vi.fn(), disconnect: vi.fn(), gain: { value: 0.2, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() } }
  audio.context = { state: 'running', currentTime: 1, destination: {}, createBufferSource: () => source, createGain: () => gain,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), close: async () => {} } as unknown as AudioContext
  audio.buffers.set('bed', { duration: 30 } as AudioBuffer)
  const segment = { offsetMs: 0, durationMs: 10000, renewable: true, loop: true }
  try {
    void audio.playBed('bed', 0.2, 25000)
    let faded = false
    const handoff = audio.holdAmbienceUntilMusic().then((): void => {
      faded = true
      return undefined
    })
    expect(source.stop).toHaveBeenLastCalledWith(1.2)
    await Promise.resolve()
    expect(faded).toBe(false)
    source.onended!()
    await handoff
    expect(source.disconnect).toHaveBeenCalled()
    expect(() => audio.playBed('bed', 0.2, 25000)).toThrow('El fondo no está disponible')
    expect(() => audio.play('bed', 0.2, segment)).toThrow('El ambiente espera')
    audio.stop()
    expect(audio.waitingForMusic).toBe(true)
    // Speech remains available during the wait, but may not recreate its bed.
    const voice = audio.play('bed', 0.5)
    source.onended!()
    await expect(voice).resolves.toBe('ENDED')
    expect(audio.waitingForMusic).toBe(true)
    audio.musicStarted()
    const ambience = audio.play('bed', 0.2, segment)
    audio.close()
    await expect(ambience).resolves.toBe('STOPPED')
  } finally { audio.close() }
})

it('bounds a blocked resume attempt and can retry without replacing the context', async () => {
  vi.useFakeTimers()
  const audio = new AnnouncementAudio()
  const context = { state: 'suspended', resume: vi.fn(() => new Promise<void>(() => {})), close: async () => {} }
  audio.context = context as unknown as AudioContext
  try {
    const blocked = expect(audio.resume()).rejects.toThrow('no habilitó')
    await vi.advanceTimersByTimeAsync(750)
    await blocked
    context.resume.mockImplementation(async () => {
      context.state = 'running'
    })
    await audio.resume()
    expect(audio.ready).toBe(true)
  } finally {
    audio.close()
    vi.useRealTimers()
  }
})

it('renews one looping source without restarting it and cannot extend after stop or lease expiry', async () => {
  const audio = new AnnouncementAudio()
  const source = { connect: vi.fn(node => node), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null as (() => void) | null, loop: false }
  const gain = { connect: vi.fn(), disconnect: vi.fn(), gain: { value: 0.2, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() } }
  const context = { state: 'running', currentTime: 0, destination: {}, createBufferSource: () => source, createGain: () => gain, addEventListener: vi.fn(), removeEventListener: vi.fn(), close: async () => {} }
  audio.context = context as unknown as AudioContext
  audio.buffers.set('loop', { duration: 30 } as AudioBuffer)
  expect(() => audio.play('loop', 0.2, { offsetMs: 0, durationMs: 0, renewable: true, loop: true })).toThrow('Tramo')
  expect(source.start).not.toHaveBeenCalled()
  const playing = audio.play('loop', 0.2, { offsetMs: 0, durationMs: 10000, renewable: true, loop: true })
  expect(source.loop).toBe(true)
  context.currentTime = 7
  expect(audio.renewAmbience(10000)).toBe(true)
  expect(source.start).toHaveBeenCalledExactlyOnceWith(0, 0)
  expect(source.stop).toHaveBeenLastCalledWith(17)
  context.currentTime = 17
  expect(audio.renewAmbience(10000)).toBe(false)
  source.onended!()
  await expect(playing).resolves.toBe('STOPPED')
  const again = audio.play('loop', 0.2, { offsetMs: 0, durationMs: 10000, renewable: true, loop: true })
  audio.stop()
  expect(audio.renewAmbience(10000)).toBe(false)
  source.onended!()
  await expect(again).resolves.toBe('STOPPED')
  audio.close()
})

it.each([
  ['effect', 'transition', 12, true], ['effect', 'transition', 12.1, false], ['effect', 'short', 8, false],
  ['ambience', undefined, 35, true], ['ambience', undefined, 35.1, false],
] as const)('validates %s/%s preparation at %s seconds in the player', async (kind, effectType, duration, allowed) => {
  const audio = new AnnouncementAudio()
  audio.context = { state: 'running', resume: async () => {}, close: async () => {}, decodeAudioData: async () => ({ duration, length: Math.round(duration * 44100), numberOfChannels: 2 }) } as unknown as AudioContext
  vi.stubGlobal('document', { baseURI: 'http://localhost/' })
  vi.stubGlobal('fetch', vi.fn(async () => new Response('transition')))
  const checksum = createHash('sha256').update('transition').digest('hex')
  const clip = { id: 'transition', checksum, durationMs: duration * 1000, kind, effectType } as AnimationClip
  const preparing = audio.unlock([clip])
  if (allowed) await expect(preparing).resolves.toEqual([checksum])
  else await expect(preparing).rejects.toThrow('duración')
  audio.close()
})

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
