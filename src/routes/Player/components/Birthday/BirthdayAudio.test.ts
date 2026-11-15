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

it('keeps required audio ready when the dedicated applause checksum is invalid', async () => {
  const { audio, asset, abort } = await fixture()
  const applause = { ...asset, id: 'bad-applause', kind: 'applause' as const }
  vi.stubGlobal('fetch', vi.fn(async () => new Response('corrupted audio')))
  await audio.prepare([applause], abort.signal)
  expect(audio.available(applause)).toBe(false)
  expect(audio.available(asset)).toBe(true)
  expect(audio.warning).toContain('aplauso')
})

async function bedFixture (local = false, failBed = false, version?: 1) {
  const events = new EventTarget()
  const nodes: { buffer: { duration: number } | null, loop: boolean, gain?: ReturnType<typeof makeGain>, onended: (() => void) | null, start: ReturnType<typeof vi.fn>, stop: ReturnType<typeof vi.fn>, disconnect: ReturnType<typeof vi.fn>, connect: (gain: ReturnType<typeof makeGain>) => ReturnType<typeof makeGain> }[] = []
  const makeGain = () => ({ gain: { value: 1, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), cancelScheduledValues: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() })
  const assets = await Promise.all((['intro', 'greeting', 'music', 'bed', 'applause'] as const).map(async (kind, index) => {
    const bytes = new TextEncoder().encode(String(index + 1))
    return { id: kind, kind, title: kind, durationMs: (index + 1) * 1000, url: `api/birthdays/assets/${kind}`, checksum: [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('') }
  }))
  vi.stubGlobal('document', { baseURI: 'https://karaoke.test/' })
  vi.stubGlobal('fetch', vi.fn(async (url: URL) => {
    const index = assets.findIndex(asset => url.pathname.endsWith(asset.id))
    return new Response(String(index + 1), { status: failBed && index === 3 ? 500 : 200 })
  }))
  const context = { currentTime: 0, state: 'running', destination: {}, sampleRate: 1000,
    createBuffer: (_channels: number, length: number, rate: number) => ({ duration: length / rate }),
    decodeAudioData: vi.fn(async (bytes: ArrayBuffer) => ({ duration: Number(new TextDecoder().decode(bytes)) })), createGain: makeGain,
    createBufferSource: () => {
      const node: typeof nodes[number] = { buffer: null, loop: false, onended: null, start: vi.fn(), stop: vi.fn(), disconnect: vi.fn(), connect: (gain) => {
        node.gain = gain
        return gain
      } }
      nodes.push(node)
      return node
    }, addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events) }
  const audio = new BirthdayAudio(context as unknown as AudioContext, local, version)
  const abort = new AbortController()
  await audio.prepare(assets, abort.signal, 0.2)
  audio.permitFor(15000)
  return { audio, assets, context, abort, nodes, events }
}

it('fades the complete song in and out while volume changes preserve the current envelope', async () => {
  const { audio, assets, context, abort, nodes } = await bedFixture()
  const playing = audio.play(assets[2], 0.8, abort.signal)
  const music = nodes[0]
  const gain = music.gain!.gain
  expect(gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.8, 1)
  expect(gain.setValueAtTime).toHaveBeenCalledWith(0.8, 1.5)
  expect(gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, 3)
  context.currentTime = 0.5
  audio.volume(0.4)
  expect(gain.setValueAtTime).toHaveBeenCalledWith(0.2, 0.5)
  expect(gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.4, 1)
  context.currentTime = 2.25
  audio.volume(0.8)
  expect(gain.setValueAtTime).toHaveBeenLastCalledWith(0.4, 2.25)
  expect(gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, 3)
  expect(music.buffer?.duration).toBe(3)
  expect(music.start).toHaveBeenCalledOnce()
  context.currentTime = 3
  music.onended!()
  await playing
})

it('starts dedicated applause with a half-second fade without shortening its end', async () => {
  const { audio, assets, context, abort, nodes } = await bedFixture()
  const playing = audio.play(assets[4], 0.7, abort.signal)
  const applause = nodes[0]
  expect(applause.gain!.gain.setValueAtTime).toHaveBeenCalledWith(0, 0)
  expect(applause.gain!.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.7, 0.5)
  expect(applause.buffer?.duration).toBe(5)
  context.currentTime = 5
  applause.onended!()
  await playing
  expect(applause.disconnect).toHaveBeenCalledOnce()
})

it('scales both song fades for a short clip instead of overlapping incompatible ramps', async () => {
  const { audio, assets, context, abort, nodes } = await bedFixture()
  const short = { ...assets[2], id: 'short', durationMs: 200 }
  context.decodeAudioData.mockResolvedValueOnce({ duration: 0.2 })
  await audio.prepare([short], abort.signal)
  const playing = audio.play(short, 1, abort.signal)
  const music = nodes[0]
  expect(music.gain!.gain.linearRampToValueAtTime.mock.calls[0][1]).toBeCloseTo(0.08)
  expect(music.gain!.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, 0.2)
  context.currentTime = 0.2
  music.onended!()
  await playing
})

it('reuses one native media source and resumes or seeks at the existing fade position', () => {
  const gain = { gain: { value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), cancelScheduledValues: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() }
  const source = { connect: vi.fn(() => gain), disconnect: vi.fn() }
  const context = { currentTime: 10, createMediaElementSource: vi.fn(() => source), createGain: () => gain, destination: {} }
  const audio = new BirthdayAudio(context as unknown as AudioContext, true, 1)
  const element = { currentTime: 0.25, duration: 3 } as HTMLMediaElement
  const asset: BirthdayAsset = { id: 'music', kind: 'music', durationMs: 3000, title: 'Music', url: 'api/birthdays/assets/music', checksum: 'checksum' }
  audio.mediaPhase(asset, element)
  expect(gain.gain.setValueAtTime).toHaveBeenCalledWith(0.25, 10)
  expect(gain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(1, 10.75)
  context.currentTime = 10.25
  element.currentTime = 0.5
  audio.mediaPhase(asset, element)
  expect(gain.gain.setValueAtTime).toHaveBeenCalledWith(0.5, 10.25)
  expect(gain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(1, 10.75)
  element.currentTime = 2.5
  audio.mediaPhase(asset, element)
  audio.volume(0.3)
  expect(gain.gain.setValueAtTime).toHaveBeenLastCalledWith(expect.closeTo(0.1), 10.25)
  expect(gain.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, 10.75)
  expect(context.createMediaElementSource).toHaveBeenCalledOnce()
  audio.stop()
  expect(source.disconnect).toHaveBeenCalledOnce()
})

it('starts the bed two seconds before the intro and holds it through the complete 2.5-second bridge', async () => {
  const { audio, context, nodes, abort } = await bedFixture(false, false, 1)
  audio.backgroundPhase('prelude', 1, 2000, abort.signal)
  const bed = nodes.find(node => node.loop)!
  expect(bed.start).toHaveBeenCalledWith(0)
  expect(bed.stop).toHaveBeenLastCalledWith(7.5)
  const prelude = audio.wait(2000, abort.signal)
  const timer = nodes.find(node => !node.loop)!
  expect(timer.buffer?.duration).toBe(2)
  context.currentTime = 2
  timer.onended!()
  await prelude
  audio.backgroundPhase('intro', 1, 1000, abort.signal)
  context.currentTime = 3
  audio.backgroundPhase('greeting', 1, 2000, abort.signal)
  expect(bed.stop).toHaveBeenLastCalledWith(7.5)
  context.currentTime = 5
  audio.backgroundPhase('bridge', 1, 2500, abort.signal)
  expect(bed.gain!.gain.setValueAtTime).toHaveBeenCalledWith(0.2, 6)
  expect(bed.gain!.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, 7.5)
  expect(bed.start).toHaveBeenCalledOnce()
  context.currentTime = 7.5
  audio.backgroundPhase('music', 1, 3000, abort.signal)
  expect(bed.disconnect).toHaveBeenCalledOnce()
  audio.backgroundPhase('applause', 1, 3000, abort.signal)
  expect(nodes.filter(node => node.loop)).toHaveLength(1)
})

it('mixes a looping bed under both voices, fades on the audio clock and stops before music starts', async () => {
  const { audio, assets, context, abort, nodes } = await bedFixture()
  const intro = audio.play(assets[0], 1, abort.signal)
  const bed = nodes.find(node => node.loop)!
  const voice = nodes.find(node => !node.loop)!
  expect(bed.start).toHaveBeenCalledWith(0)
  expect(voice.start).toHaveBeenCalledWith(0)
  expect(bed.stop).toHaveBeenLastCalledWith(3)
  context.currentTime = 1
  voice.onended!()
  await intro
  const greeting = audio.play(assets[1], 1, abort.signal)
  expect(bed.disconnect).not.toHaveBeenCalled()
  expect(bed.gain!.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, 3)
  audio.volume(0.5)
  expect(bed.gain!.gain.setValueAtTime).toHaveBeenCalledWith(0.1, 1)
  context.currentTime = 3
  nodes[nodes.length - 1].onended!()
  await greeting
  const music = audio.play(assets[2], 0.5, abort.signal)
  expect(bed.disconnect).toHaveBeenCalledOnce()
  expect(bed.disconnect.mock.invocationCallOrder[0]).toBeLessThan(nodes[nodes.length - 1].start.mock.invocationCallOrder[0])
  context.currentTime = 6
  nodes[nodes.length - 1].onended!()
  await music
})

it('cuts both sources on abort and cannot renew a bed past an expired grant', async () => {
  const { audio, assets, context, abort, nodes } = await bedFixture()
  audio.permitFor(500)
  const playing = audio.play(assets[0], 1, abort.signal)
  const rejected = expect(playing).rejects.toThrow('interrumpió')
  const bed = nodes.find(node => node.loop)!
  expect(bed.stop).toHaveBeenLastCalledWith(0.5)
  context.currentTime = 1
  audio.permitFor(15000)
  expect(bed.stop).toHaveBeenLastCalledWith(0.5)
  abort.abort()
  await rejected
  expect(nodes.every(node => node.disconnect.mock.calls.length === 1)).toBe(true)
})

it('keeps optional-bed failure separate from required voice playback', async () => {
  const { audio, assets, context, abort, nodes } = await bedFixture(false, true)
  expect(audio.warning).toContain('sin acompañamiento')
  const intro = audio.play(assets[0], 1, abort.signal)
  expect(nodes).toHaveLength(1)
  context.currentTime = 1
  nodes[0].onended!()
  await intro
})

it('preserves the bed during a local preview pause, but stops it on close and skips it for music-only preview', async () => {
  const { audio, context, abort, nodes, events } = await bedFixture(true)
  audio.backgroundPhase('music', 1, 3000, abort.signal)
  expect(nodes).toHaveLength(0)
  audio.backgroundPhase('greeting', 1, 2000, abort.signal)
  const bed = nodes[0]
  context.state = 'suspended'
  events.dispatchEvent(new Event('statechange'))
  expect(bed.disconnect).not.toHaveBeenCalled()
  abort.abort()
  expect(bed.disconnect).toHaveBeenCalledOnce()
})
