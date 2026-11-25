import { afterEach, expect, it, vi } from 'vitest'
import AnnouncementAudio from './AnnouncementAudio'
import type { AnimationClip } from '../../../../../shared/animation.js'
import { createHash } from 'node:crypto'
import type { GreetingAsset } from '../../../../../shared/greetings.js'
import { playbackTraceSnapshot } from '../../../../lib/playbackTrace'

afterEach(() => vi.unstubAllGlobals())

it.each(['download', 'checksum', 'decode', 'duration'])('isolates a catalog %s failure and retains later valid clips', async (stage) => {
  const audio = new AnnouncementAudio()
  const hash = (text: string) => createHash('sha256').update(text).digest('hex')
  audio.context = { state: 'running', close: async () => {}, decodeAudioData: async (bytes: ArrayBuffer) => {
    const text = new TextDecoder().decode(bytes)
    if (text === 'bad' && stage === 'decode') throw new Error('Invalid audio')
    return { duration: text === 'bad' && stage === 'duration' ? 40 : 1, length: 24000, numberOfChannels: 1 }
  } } as unknown as AudioContext
  vi.stubGlobal('document', { baseURI: 'http://localhost/' })
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/bad') && stage === 'download'
    ? new Response('', { status: 503 })
    : new Response(url.split('/').pop())))
  const clips = ['bad', 'good'].map(id => ({ id, title: id, checksum: hash(id === 'bad' && stage === 'checksum' ? 'expected' : id), durationMs: 1000, kind: 'voice' } as AnimationClip))
  try {
    await expect(audio.prepare(clips)).resolves.toEqual([clips[1].checksum])
    expect(audio.readyChecksums).toEqual([clips[1].checksum])
    expect(audio.preparationErrors.size).toBe(1)
    expect(playbackTraceSnapshot().events.some(event => event.event === 'catalog-asset-failed' && event.reason === stage)).toBe(true)
  } finally { audio.close() }
})

it('prepares an urgent turn without waiting for an unrelated catalog download', async () => {
  const audio = new AnnouncementAudio()
  audio.context = { state: 'running', close: async () => {}, decodeAudioData: async () => ({ duration: 1, length: 24000, numberOfChannels: 1 }) } as unknown as AudioContext
  vi.stubGlobal('document', { baseURI: 'http://localhost/' })
  let finishCatalog!: (value: Response) => void
  vi.stubGlobal('fetch', vi.fn((url: string) => url.endsWith('catalog')
    ? new Promise<Response>((resolve) => { finishCatalog = resolve })
    : Promise.resolve(new Response('turn'))))
  const hash = (text: string) => createHash('sha256').update(text).digest('hex')
  const catalog = audio.prepare([{ id: 'catalog', checksum: hash('catalog'), durationMs: 1000, kind: 'voice' } as AnimationClip])
  await vi.waitFor(() => expect(finishCatalog).toBeTypeOf('function'))
  const asset = { id: 'call', role: 'call', url: 'api/turn', checksum: hash('turn'), durationMs: 1000, kind: 'voice' } as GreetingAsset
  try {
    await expect(audio.prepareGreetingAssets([asset], () => true, true)).resolves.toEqual([asset.checksum])
    expect(audio.readyChecksums).toContain(asset.checksum)
    finishCatalog(new Response('catalog'))
    await catalog
    expect(audio.readyChecksums).toContain(asset.checksum)
  } finally { audio.close() }
})

it('retains Karaoke reminder buffers across ordinary preparation and releases them when their turn changes', async () => {
  const audio = new AnnouncementAudio()
  audio.context = { state: 'running', close: async () => {}, decodeAudioData: async () => ({ duration: 1, length: 24000, numberOfChannels: 1 }) } as unknown as AudioContext
  vi.stubGlobal('document', { baseURI: 'http://localhost/' })
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(url.split('/').pop())))
  const clip = (id: string) => ({ id, title: id, checksum: createHash('sha256').update(id).digest('hex'), durationMs: 1000, kind: 'voice' } as AnimationClip)
  try {
    await audio.prepare([clip('catalog')])
    await audio.prepare([clip('table')], 'karaoke')
    await audio.prepare([])
    expect(audio.buffers.has(clip('table').checksum)).toBe(true)
    await audio.prepare([], 'karaoke')
    expect(audio.buffers.has(clip('table').checksum)).toBe(false)
  } finally { audio.close() }
})

it('publishes the prepared Karaoke reminder ahead of a full ordinary readiness window', async () => {
  const audio = new AnnouncementAudio()
  audio.context = { state: 'running', close: async () => {}, decodeAudioData: async () => ({ duration: 1, length: 24000, numberOfChannels: 1 }) } as unknown as AudioContext
  vi.stubGlobal('document', { baseURI: 'http://localhost/' })
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(url.split('/').pop())))
  const clip = (id: string) => ({ id, title: id, checksum: createHash('sha256').update(id).digest('hex'), durationMs: 1000, kind: 'voice', url: `api/${id}` } as AnimationClip & { url: string })
  const reminders = [clip('table'), clip('karaoke')]
  try {
    await audio.prepare(Array.from({ length: 24 }, (_, index) => clip(`catalog-${index}`)))
    await audio.prepareGreetingAssets([
      ...Array.from({ length: 3 }, (_, index) => ({ ...clip(`call-${index}`), role: 'call' as const })),
      ...Array.from({ length: 3 }, (_, index) => ({ ...clip(`greeting-${index}`), role: 'greeting' as const })),
    ])
    await audio.prepare(reminders, 'karaoke')
    expect(audio.readyChecksums).toHaveLength(30)
    expect(reminders.every(clip => audio.readyChecksums.includes(clip.checksum))).toBe(true)
  } finally { audio.close() }
})

it('does not evict the current Karaoke reminder to make room for greeting preparation', async () => {
  const audio = new AnnouncementAudio()
  audio.context = { state: 'running', close: async () => {}, decodeAudioData: async (bytes: ArrayBuffer) => {
    const small = new TextDecoder().decode(bytes).startsWith('reminder')
    return small ? { duration: 1, length: 24000, numberOfChannels: 1 } : { duration: 10, length: 441000, numberOfChannels: 2 }
  } } as unknown as AudioContext
  vi.stubGlobal('document', { baseURI: 'http://localhost/' })
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(url.split('/').pop())))
  const clip = (id: string, durationMs = 10000) => ({ id, title: id, checksum: createHash('sha256').update(id).digest('hex'), durationMs, kind: 'voice', url: `api/${id}` } as AnimationClip & { url: string })
  const reminders = [clip('reminder-table', 1000), clip('reminder-karaoke', 1000)]
  try {
    await audio.prepare(reminders, 'karaoke')
    await audio.prepare(Array.from({ length: 18 }, (_, index) => clip(`catalog-${index}`)))
    await audio.prepareGreetingAssets([{ ...clip('new-greeting'), role: 'greeting' }])
    expect(audio.decodedBytes).toBeLessThanOrEqual(audio.maxDecodedBytes)
    expect(reminders.every(clip => audio.buffers.has(clip.checksum))).toBe(true)
  } finally { audio.close() }
})

it('records failed preparation stages and rejects a late response for an obsolete turn', async () => {
  const audio = new AnnouncementAudio()
  const decode = vi.fn(async () => ({ duration: 1, length: 24000, numberOfChannels: 1 }))
  audio.context = { state: 'running', close: async () => {}, decodeAudioData: decode } as unknown as AudioContext
  vi.stubGlobal('document', { baseURI: 'http://localhost/' })
  const asset = { id: 'call', role: 'call', url: 'api/turn', checksum: createHash('sha256').update('turn').digest('hex'), durationMs: 1000, kind: 'voice' } as GreetingAsset
  vi.stubGlobal('fetch', vi.fn(async () => new Response('Unavailable', { status: 503 })))
  expect(await audio.prepareGreetingAssets([asset])).toEqual([])
  expect(playbackTraceSnapshot().events.reverse()[0]).toMatchObject({ event: 'turn-asset-failed', reason: 'download', checksum: asset.checksum })
  let current = true
  let finish!: (value: Response) => void
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => {
    finish = resolve
  })))
  const pending = audio.prepareGreetingAssets([asset], () => current, true)
  current = false
  finish(new Response('turn'))
  expect(await pending).toEqual([])
  expect(decode).not.toHaveBeenCalled()
  audio.close()
})

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

it.each([
  [130, true, true], [130.1, true, false], [130, false, false],
] as const)('validates a %ss bed with Karaoke scope=%s in both preparation paths', async (duration, scoped, allowed) => {
  const checksum = createHash('sha256').update('long bed').digest('hex')
  const clip = { id: 'bed', roomId: 1, source: 'Karaoke', kind: 'ambience' as const, title: 'Long bed', displayText: '', license: 'Fixture',
    checksum, durationMs: duration * 1000, url: scoped ? 'api/rooms/1/karaoke-calls/backgrounds/assets/bed' : 'api/animation/assets/bed' }
  vi.stubGlobal('document', { baseURI: 'http://localhost/karaoke/' })
  vi.stubGlobal('fetch', vi.fn(async () => new Response('long bed')))
  for (const mode of ['catalog', 'turn']) {
    const audio = new AnnouncementAudio()
    audio.context = { state: 'running', close: async () => {}, decodeAudioData: async () => ({ duration, length: Math.round(duration * 44100), numberOfChannels: 2 }) } as unknown as AudioContext
    const result = mode === 'catalog' ? await audio.prepare([clip]) : await audio.prepareGreetingAssets([{ ...clip, role: 'bed' }])
    expect(result).toEqual(allowed ? [checksum] : [])
    expect(audio.decodedBytes).toBeLessThanOrEqual(audio.maxDecodedBytes)
    audio.close()
  }
})

it.each([44100, 48000])('keeps announcement families, general ambience and a two-minute Karaoke bed ready at %i Hz', async (sampleRate) => {
  const families = ['welcome', 'goodbye', 'celebration', 'closing', 'invitation', 'booth', 'turn'] as const
  const voices = families.map(family => ({ id: family, kind: 'voice', family, durationMs: 6000 }))
  const ambience = ['ambient-one', 'ambient-two'].map(id => ({ id, kind: 'ambience', durationMs: 30120 }))
  const bed = { id: 'karaoke-bed', kind: 'ambience', source: 'Karaoke', roomId: 1, durationMs: 120033,
    url: 'api/rooms/1/karaoke-calls/backgrounds/assets/karaoke-bed' }
  const catalog = [...voices, ...ambience, bed].map(item => ({ ...item, checksum: createHash('sha256').update(item.id).digest('hex') } as AnimationClip))
  const decodeAt = (rate: number) => async (bytes: ArrayBuffer) => {
    const id = Buffer.from(bytes).toString()
    const duration = catalog.find(clip => clip.id === id)!.durationMs / 1000
    return { duration, length: Math.round(duration * rate), numberOfChannels: 2 }
  }
  vi.stubGlobal('OfflineAudioContext', class {
    decodeAudioData: ReturnType<typeof decodeAt>
    constructor (_channels: number, _length: number, rate: number) { this.decodeAudioData = decodeAt(rate) }
  })
  vi.stubGlobal('document', { baseURI: 'http://localhost/karaoke/' })
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(url.split('/').pop())))
  const audio = new AnnouncementAudio()
  audio.context = { state: 'running', sampleRate, close: async () => {}, decodeAudioData: decodeAt(sampleRate) } as unknown as AudioContext

  await audio.prepare(catalog)

  expect(audio.readyChecksums).toEqual(catalog.map(clip => clip.checksum))
  expect(audio.decodedBytes).toBeLessThanOrEqual(audio.maxDecodedBytes)
  const preparedBed = audio.buffers.get(catalog[catalog.length - 1].checksum)!
  expect(preparedBed.duration).toBeCloseTo(120.033, 3)
  expect(preparedBed.numberOfChannels).toBe(2)
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

it('plays a two-second applause excerpt with a fade while keeping its full decoded source intact', async () => {
  const audio = new AnnouncementAudio()
  const source = { connect: vi.fn(node => node), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null as (() => void) | null, loop: false }
  const gain = { connect: vi.fn(), disconnect: vi.fn(), gain: { value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() } }
  const context = { state: 'running', currentTime: 10, destination: {}, createBufferSource: () => source, createGain: () => gain,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), close: async () => {} }
  audio.context = context as unknown as AudioContext
  audio.buffers.set('applause', { duration: 4.44 } as AudioBuffer)
  const playback = audio.play('applause', 0.5, { offsetMs: 0, durationMs: 2000, fadeOutMs: 200 })
  expect(source.start).toHaveBeenCalledWith(0, 0, 2)
  expect(source.stop).toHaveBeenCalledWith(12)
  expect(gain.gain.setValueAtTime).toHaveBeenCalledWith(0.5, 11.8)
  expect(gain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, 12)
  context.currentTime = 12
  source.onended!()
  await expect(playback).resolves.toBe('ENDED')
  expect(audio.buffers.get('applause')?.duration).toBe(4.44)
  audio.close()
})

it.each(['command', 'suspended', 'close'])('overlaps entry, voice and bed and cancels the entrance on %s', async (operation) => {
  const audio = new AnnouncementAudio()
  const sources: Array<{ start: ReturnType<typeof vi.fn>, stop: ReturnType<typeof vi.fn>, disconnect: ReturnType<typeof vi.fn>, onended: (() => void) | null }> = []
  const gains: Array<{ gain: { value: number, setValueAtTime: ReturnType<typeof vi.fn>, linearRampToValueAtTime: ReturnType<typeof vi.fn> } }> = []
  const listeners = new Set<() => void>()
  const context = { state: 'running', currentTime: 10, destination: {}, close: async () => {},
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
    createBufferSource: () => {
      const source = { connect: vi.fn(node => node), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null as (() => void) | null }
      sources.push(source)
      return source
    },
    createGain: () => {
      const gain = { connect: vi.fn(), disconnect: vi.fn(), gain: { value: 0.5, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() } }
      gains.push(gain)
      return gain
    },
  }
  audio.context = context as unknown as AudioContext
  for (const [hash, duration] of [['entry', 3.893], ['voice', 7], ['bed', 30]] as const) audio.buffers.set(hash, { duration } as AudioBuffer)
  const bed = audio.playBed('bed', 0.2, 20000)
  const entry = audio.playEffect('entry', 0.5)
  expect(() => audio.playEffect('entry', 0.5)).toThrow('no está disponible')
  context.currentTime = 11.5
  const voice = audio.play('voice', 0.5)
  expect(sources).toHaveLength(3)
  expect(sources.every(source => source.start.mock.calls.length === 1)).toBe(true)
  expect(gains[1].gain.setValueAtTime).toHaveBeenCalledWith(0.5, 13.893 - 0.2)
  expect(sources[1].stop).toHaveBeenCalledWith(13.893)
  if (operation === 'suspended') {
    context.state = 'suspended'
    for (const listener of listeners) listener()
  } else if (operation === 'close') audio.close()
  else audio.stopForeground('test-command')
  if (operation === 'command') {
    expect(sources[0].stop).toHaveBeenLastCalledWith(30)
    sources[1].onended!()
    sources[2].onended!()
  }
  await expect(entry).resolves.toBe('STOPPED')
  await expect(voice).resolves.toBe('STOPPED')
  audio.close()
  await expect(bed).resolves.toBe('STOPPED')
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

it('renews a waiting karaoke bed on one source and cannot revive it after stop or expiry', async () => {
  const audio = new AnnouncementAudio()
  const source = { connect: vi.fn(node => node), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null as (() => void) | null, loop: false }
  const gain = { connect: vi.fn(), disconnect: vi.fn(), gain: { value: 0.2, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() } }
  const context = { state: 'running', currentTime: 0, destination: {}, createBufferSource: () => source, createGain: () => gain, addEventListener: vi.fn(), removeEventListener: vi.fn(), close: async () => {} }
  audio.context = context as unknown as AudioContext
  audio.buffers.set('bed', { duration: 2 } as AudioBuffer)
  const playing = audio.playBed('bed', 0.2, 5000, true)
  audio.duckBed(true)
  audio.bedVolume(0.4)
  expect(gain.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, 5)
  expect(gain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.1, 0.25)
  context.currentTime = 4
  expect(audio.renewBed(10000)).toBe(true)
  expect(gain.gain.setValueAtTime).toHaveBeenLastCalledWith(0.1, 13.75)
  audio.duckBed(false)
  expect(gain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.4, 4.25)
  expect(source.start).toHaveBeenCalledTimes(1)
  expect(source.stop).toHaveBeenLastCalledWith(14)
  context.currentTime = 14
  expect(audio.renewBed(10000)).toBe(false)
  void audio.stopBed(0)
  expect(audio.renewBed(10000)).toBe(false)
  source.onended!()
  await expect(playing).resolves.toBe('STOPPED')
  audio.close()
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
  else {
    await expect(preparing).resolves.toEqual([])
    expect(audio.preparationErrors.has(clip.id)).toBe(true)
  }
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
