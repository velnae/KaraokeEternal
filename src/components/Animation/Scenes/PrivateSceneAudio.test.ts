import { afterEach, expect, it, vi } from 'vitest'
import { sceneCue, type ResolvedSceneCue } from 'shared/eventScenes'
import PrivateSceneAudio from './PrivateSceneAudio'

afterEach(() => vi.unstubAllGlobals())
it('seeks through decoded private media and schedules the matching audio offset and fade', async () => {
  const nodes: Array<{ start: ReturnType<typeof vi.fn>, stop: ReturnType<typeof vi.fn> }> = []
  const gain = { connect: vi.fn(), disconnect: vi.fn(), gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() } }
  const context = { state: 'running', currentTime: 0, sampleRate: 1000, resume: vi.fn(async () => {}), close: vi.fn(async () => {}),
    decodeAudioData: vi.fn(async () => ({ duration: 2, length: 2000, numberOfChannels: 1 })), createGain: () => gain,
    createBufferSource: () => {
      const node = { start: vi.fn(), stop: vi.fn(), connect: vi.fn(() => gain), disconnect: vi.fn(), onended: null as (() => void) | null }
      nodes.push(node)
      return node
    } }
  vi.stubGlobal('AudioContext', class {
    constructor () { return context }
  })
  vi.stubGlobal('document', { baseURI: 'https://development.test/' })
  const fetcher = vi.fn(async (url: URL | string) => {
    expect(url.toString()).toContain('/api/animation/assets/')
    return new Response(new Uint8Array([1, 2, 3]))
  })
  vi.stubGlobal('fetch', fetcher)
  const cue: ResolvedSceneCue = { ...sceneCue('announcement', 'voice'), startMs: 0, endMs: 2000, volume: 0.4, fadeMs: 500, resource: { id: 'voice', url: 'api/animation/assets/voice', durationMs: 2000 } }
  const audio = new PrivateSceneAudio()
  await audio.resume()
  expect(await audio.prepare([cue])).toBe(true)
  audio.start([cue], 1500)
  expect(nodes[0].start).toHaveBeenCalledWith(0, 1.5)
  expect(nodes[0].stop).toHaveBeenCalledWith(0.5)
  expect(gain.gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, 0.5)
  context.currentTime = 0.25
  expect(audio.position()).toBe(1750)
  audio.stop()
  await audio.prepare([cue])
  audio.start([cue], 0)
  expect(nodes[1].start).toHaveBeenCalledWith(0.25, 0)
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(fetcher.mock.calls[0][0].toString()).toContain('/api/animation/assets/voice')
  audio.close()
  expect(context.close).toHaveBeenCalledOnce()
})
it('rejects a replaced resource before decoding or playing the wrong sample', async () => {
  const context = { state: 'running', resume: vi.fn(async () => {}), close: vi.fn(async () => {}), decodeAudioData: vi.fn() }
  vi.stubGlobal('AudioContext', class {
    constructor () { return context }
  })
  vi.stubGlobal('document', { baseURI: 'https://development.test/' })
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([9, 8, 7]))))
  const cue: ResolvedSceneCue = { ...sceneCue('announcement', 'voice'), startMs: 0, endMs: 2000, resource: { id: 'changed', durationMs: 2000, url: 'api/animation/assets/changed', checksum: '0'.repeat(64) } }
  const audio = new PrivateSceneAudio()
  await audio.resume()
  await expect(audio.prepare([cue])).rejects.toThrow('El recurso cambió')
  expect(context.decodeAudioData).not.toHaveBeenCalled()
  audio.close()
})
