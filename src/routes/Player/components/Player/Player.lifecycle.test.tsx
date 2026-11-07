import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type React from 'react'
import Player from './Player'

vi.mock('react', () => ({ default: {
  PureComponent: class {
    props: unknown
    state = {}
    constructor (props: unknown) { this.props = props }
    setState (state: object) { Object.assign(this.state, state) }
  },
  lazy: (): null => null,
  createRef: () => ({ current: null as unknown }),
} }))
vi.mock('./CDGPlayer/CDGPlayer', () => ({ default: (): null => null }))
vi.mock('./MP4Player/MP4Player', () => ({ default: (): null => null }))
vi.mock('./MP4Player/MP4AlphaPlayer', () => ({ default: (): null => null }))
vi.mock('./YouTubePlayer/YouTubePlayer', () => ({ default: (): null => null }))

class TestAudioContext {
  state = 'running'
  currentTime = 0
  destination = {}
  elements = new Set<HTMLMediaElement>()
  gain = { connect: vi.fn(), disconnect: vi.fn(), gain: { setValueAtTime: vi.fn() } }
  createGain = vi.fn(() => this.gain)
  createMediaElementSource = vi.fn((mediaElement: HTMLMediaElement) => {
    if (this.elements.has(mediaElement)) throw new Error('Media element already has a source')
    this.elements.add(mediaElement)
    return { mediaElement, connect: vi.fn(), disconnect: vi.fn() }
  })

  resume = vi.fn(async () => { this.state = 'running' })

  close = vi.fn(() => {
    if (this.state === 'closed') return Promise.reject(new Error('Cannot close a closed AudioContext.'))
    this.state = 'closed'
    return Promise.resolve()
  })
}

beforeEach(() => vi.stubGlobal('window', { AudioContext: TestAudioContext }))
afterEach(() => vi.unstubAllGlobals())

function setup (overrides: Partial<React.ComponentProps<typeof Player>> = {}) {
  const props: Partial<React.ComponentProps<typeof Player>> = { source: 'LOCAL', volume: 0.5, isPlaying: false, onError: vi.fn(), ...overrides }
  return new Player(props as React.ComponentProps<typeof Player>)
}

function update (player: Player, changes: Partial<React.ComponentProps<typeof Player>>) {
  const previous = player.props
  Object.defineProperty(player, 'props', { value: { ...previous, ...changes }, configurable: true })
  player.componentDidUpdate(previous)
}

describe('music audio lifecycle', () => {
  it('plays YouTube without opening a local audio device, even when Web Audio is unavailable', async () => {
    const AudioContext = vi.fn(function () {
      throw new Error('Audio device unavailable')
    })
    vi.stubGlobal('window', { AudioContext })
    const player = setup({ source: 'YOUTUBE' })
    player.componentDidMount()
    update(player, { isPlaying: true })
    update(player, { isPlaying: false })
    player.componentWillUnmount()
    await Promise.resolve()
    expect(AudioContext).not.toHaveBeenCalled()
    expect(player.props.onError).not.toHaveBeenCalled()
  })

  it('preserves the graph through StrictMode setup-cleanup-setup', async () => {
    const player = setup()
    const element = {} as HTMLVideoElement
    player.componentDidMount()
    player.handleAudioElement(element)
    const context = player.audioCtx as unknown as TestAudioContext
    const source = player.audioSourceNode!
    player.componentWillUnmount()
    player.componentDidMount()
    player.handleAudioElement(element)
    await Promise.resolve()
    expect(player.audioCtx).toBe(context)
    expect(context.close).not.toHaveBeenCalled()
    expect(source.disconnect).not.toHaveBeenCalled()
    expect(context.createMediaElementSource).toHaveBeenCalledTimes(1)
    player.componentWillUnmount()
    await Promise.resolve()
    expect(context.close).toHaveBeenCalledTimes(1)
  })

  it('releases a real unmount exactly once and clears closed references', async () => {
    const player = setup()
    player.handleAudioElement({} as HTMLVideoElement)
    player.componentDidMount()
    const context = player.audioCtx as unknown as TestAudioContext
    player.componentWillUnmount()
    player.componentWillUnmount()
    await Promise.resolve()
    player.componentWillUnmount()
    await Promise.resolve()
    expect(context.close).toHaveBeenCalledTimes(1)
    expect(player.audioCtx).toBeNull()
    expect(player.audioGainNode).toBeNull()
    expect(player.audioSourceNode).toBeNull()
  })

  it('connects audio when a media child mounts before the parent', async () => {
    const player = setup()
    player.handleAudioElement({} as HTMLVideoElement)
    const context = player.audioCtx as unknown as TestAudioContext
    player.componentDidMount()
    expect(context.createMediaElementSource).toHaveBeenCalledTimes(1)
    expect(player.audioSourceNode?.connect).toHaveBeenCalledWith(context.gain)
    expect(context.gain.gain.setValueAtTime).toHaveBeenCalledWith(0.5, 0)
    player.componentWillUnmount()
    await Promise.resolve()
  })

  it('reuses a source when the same media element is reattached', async () => {
    const player = setup()
    const first = {} as HTMLVideoElement
    player.handleAudioElement(first)
    const context = player.audioCtx as unknown as TestAudioContext
    player.handleAudioElement({} as HTMLVideoElement)
    player.handleAudioElement(first)
    expect(context.createMediaElementSource).toHaveBeenCalledTimes(2)
    player.componentWillUnmount()
    await Promise.resolve()
  })

  it('does not close an already closed context', async () => {
    const player = setup()
    player.handleAudioElement({} as HTMLVideoElement)
    player.componentDidMount()
    const context = player.audioCtx as unknown as TestAudioContext
    context.state = 'closed'
    player.componentWillUnmount()
    await Promise.resolve()
    expect(context.close).not.toHaveBeenCalled()
    expect(player.audioCtx).toBeNull()
  })

  it('resumes a local media graph when the child mounts with playback already requested', async () => {
    vi.stubGlobal('window', { AudioContext: class extends TestAudioContext { state = 'suspended' } })
    const player = setup({ isPlaying: true })
    player.handleAudioElement({} as HTMLVideoElement)
    const context = player.audioCtx as unknown as TestAudioContext
    expect(context.resume).toHaveBeenCalledOnce()
    player.componentWillUnmount()
    await Promise.resolve()
  })

  it('releases local audio on a switch to YouTube and ignores a late local resume failure', async () => {
    const player = setup()
    player.handleAudioElement({} as HTMLVideoElement)
    const context = player.audioCtx as unknown as TestAudioContext
    context.state = 'suspended'
    let rejectResume!: (reason: Error) => void
    context.resume.mockImplementationOnce(() => new Promise<void>((resolve, reject) => {
      rejectResume = reject
    }))
    update(player, { isPlaying: true })
    update(player, { source: 'YOUTUBE' })
    rejectResume(new Error('Old audio device failed'))
    await Promise.resolve()
    expect(context.close).toHaveBeenCalledOnce()
    expect(player.audioCtx).toBeNull()
    expect(player.props.onError).not.toHaveBeenCalled()

    update(player, { source: 'LOCAL' })
    player.handleAudioElement({} as HTMLVideoElement)
    expect(player.audioCtx).not.toBe(context)
    player.componentWillUnmount()
    await Promise.resolve()
  })

  it('still reports a resume failure for the current local song', async () => {
    const player = setup()
    player.handleAudioElement({} as HTMLVideoElement)
    const context = player.audioCtx as unknown as TestAudioContext
    context.state = 'suspended'
    context.resume.mockRejectedValueOnce(new Error('Audio device unavailable'))
    update(player, { isPlaying: true })
    await Promise.resolve()
    expect(player.props.onError).toHaveBeenCalledWith('No se pudo habilitar el audio: Audio device unavailable')
    player.componentWillUnmount()
    await Promise.resolve()
  })
})
