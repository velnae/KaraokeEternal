import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type React from 'react'
import YouTubePlayer from './YouTubePlayer'

// The Node harness calls the class lifecycle directly rather than mounting a DOM.
vi.mock('react', () => ({
  default: {
    Component: class {
      props: unknown
      state = {}
      constructor (props: unknown) { this.props = props }
      setState (state: object) { Object.assign(this.state, state) }
    },
    createRef: () => ({ current: null as HTMLElement | null }),
  },
}))
vi.mock('../../../../../components/Button/Button', () => ({ default: (): null => null }))

type Props = React.ComponentProps<typeof YouTubePlayer>

const PLAYING = 1
const PAUSED = 2
const ENDED = 0

describe('YouTube player transitions', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { YT: { PlayerState: { PLAYING, PAUSED, ENDED } } })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  const setup = (overrides: Partial<Props> = {}) => {
    const commands: string[] = []
    let cuedVideoId = overrides.videoId ?? 'first'
    const statuses: Array<{ isPlaying?: boolean, position?: number }> = []
    const onEnd = vi.fn()
    const onError = vi.fn()
    const iframe = {
      loadVideoById: vi.fn((id: string) => {
        commands.push(`load:${id}`)
        // The old video's PAUSED notification may arrive during the new load.
        player.handleStateChange({ data: PAUSED, target: iframe })
      }),
      cueVideoById: vi.fn((id: string) => {
        commands.push(`cue:${id}`)
        cuedVideoId = id
        player.handleStateChange({ data: 5, target: iframe })
      }),
      pauseVideo: vi.fn(() => commands.push('pause')),
      playVideo: vi.fn(() => commands.push('play')),
      destroy: vi.fn(),
      seekTo: vi.fn(),
      setSize: vi.fn(),
      setVolume: vi.fn(),
      getCurrentTime: vi.fn(() => 0),
      getVideoUrl: vi.fn(() => `https://www.youtube.com/watch?v=${cuedVideoId}`),
      getDuration: vi.fn(() => 180),
    }
    const makeProps = (overrides: Partial<Props> = {}): Props => ({
      height: 720,
      isPlaying: true,
      mediaKey: 1,
      onEnd,
      onError,
      onLoad: vi.fn(),
      onPlay: vi.fn(),
      onStatus: (status) => {
        statuses.push(status)
        if (typeof status.isPlaying === 'boolean' && status.isPlaying !== player.props.isPlaying) {
          update({ isPlaying: status.isPlaying })
        }
      },
      videoId: 'first',
      volume: 1,
      width: 1280,
      ...overrides,
    })
    const player = new YouTubePlayer(makeProps(overrides))
    player.player = iframe as unknown as NonNullable<typeof player.player>
    player.isMounted = true
    player.isReady = true

    const update = (changes: Partial<Props>) => {
      const previous = player.props
      Object.defineProperty(player, 'props', {
        configurable: true,
        value: { ...previous, ...changes },
      })
      player.componentDidUpdate(previous)
    }
    const event = (data: number) => player.handleStateChange({ data, target: iframe })

    return { commands, event, iframe, onEnd, onError, player, statuses, update }
  }

  it.each([undefined, 0] as const)('uses controls=%s without changing the shared component default', (controls) => {
    const { player, iframe } = setup()
    Object.defineProperty(player, 'props', { value: { ...player.props, controls } })
    player.player = null
    Object.defineProperty(player.container, 'current', { value: { replaceChildren: vi.fn() } })
    vi.stubGlobal('document', { createElement: () => ({}) })
    Object.defineProperty(window, 'location', { value: { origin: 'https://karaoke.example' } })
    const construct = vi.fn(function () {
      return iframe
    })
    player.createPlayer({ Player: construct, PlayerState: { PLAYING, PAUSED, ENDED } })
    expect(construct).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      playerVars: expect.objectContaining({ controls: controls ?? 1 }),
    }))
    player.componentWillUnmount()
  })

  describe('development seeking', () => {
    beforeEach(() => {
      vi.stubEnv('NODE_ENV', 'development')
      vi.stubEnv('DEV_PLAYER_TOOLS', 'true')
    })

    it('seeks near the end without simulating completion', () => {
      const { player, iframe, event, onEnd } = setup()
      player.seekForDevelopment('end')
      expect(iframe.seekTo).toHaveBeenCalledWith(175, true)
      expect(onEnd).not.toHaveBeenCalled()
      event(ENDED)
      expect(onEnd).toHaveBeenCalledOnce()
      player.componentWillUnmount()
    })

    it('advances from the actual iframe time and leaves a real tail at the end', () => {
      const { player, iframe } = setup()
      iframe.getCurrentTime.mockReturnValue(60)
      player.seekForDevelopment('forward')
      expect(iframe.seekTo).toHaveBeenLastCalledWith(90, true)
      iframe.getCurrentTime.mockReturnValue(170)
      player.seekForDevelopment('forward')
      expect(iframe.seekTo).toHaveBeenLastCalledWith(179, true)
      iframe.getDuration.mockReturnValue(3)
      player.seekForDevelopment('end')
      expect(iframe.seekTo).toHaveBeenLastCalledWith(0, true)
      player.componentWillUnmount()
    })

    it('preserves pause instead of starting playback', () => {
      const { player, iframe, update } = setup()
      update({ isPlaying: false })
      expect(player.seekForDevelopment('end')).toContain('Pulsa Reproducir')
      expect(iframe.pauseVideo).toHaveBeenCalledTimes(2)
      expect(iframe.playVideo).not.toHaveBeenCalled()
      player.componentWillUnmount()
    })

    it.each([0, NaN, Infinity])('waits for valid duration metadata (%s)', (duration) => {
      const { player, iframe } = setup()
      iframe.getDuration.mockReturnValue(duration)
      expect(player.seekForDevelopment('end')).toContain('Esperando al video')
      expect(iframe.seekTo).not.toHaveBeenCalled()
      player.componentWillUnmount()
    })

    it('does not seek before readiness, during a new load or after unmount', () => {
      const { player, iframe } = setup()
      player.isReady = false
      player.seekForDevelopment('end')
      player.isReady = true
      player.awaitingPlayback = true
      player.seekForDevelopment('forward')
      player.componentWillUnmount()
      player.seekForDevelopment('end')
      expect(iframe.seekTo).not.toHaveBeenCalled()
    })

    it.each([['production', 'true'], ['development', 'false'], ['development', '']])('is unavailable in %s with flag %s', (mode, flag) => {
      vi.stubEnv('NODE_ENV', mode)
      vi.stubEnv('DEV_PLAYER_TOOLS', flag)
      const { player, iframe } = setup()
      player.seekForDevelopment('end')
      expect(iframe.seekTo).not.toHaveBeenCalled()
      player.componentWillUnmount()
    })
  })

  it('keeps the next video playing despite a PAUSED event from the old video during load', () => {
    const { commands, event, player, statuses, update } = setup()

    update({ mediaKey: 2, videoId: 'second' })

    expect(commands).toEqual(['load:second'])
    expect(player.props.isPlaying).toBe(true)
    expect(statuses).not.toContainEqual({ isPlaying: false })

    event(PLAYING)
    expect(player.props.isPlaying).toBe(true)
    player.componentWillUnmount()
  })

  it('cues during the transition without publishing playback or advancing the queue', () => {
    const { player, iframe, update, event, statuses, onEnd } = setup()
    event(PLAYING)
    statuses.length = 0
    vi.mocked(player.props.onPlay).mockClear()
    update({ isActive: false, isPlaying: false, mediaKey: 2, videoId: 'second' })
    event(PAUSED)
    event(ENDED)
    player.handleAutoplayBlocked({ target: iframe })
    expect(iframe.cueVideoById).toHaveBeenCalledWith('second')
    expect(iframe.loadVideoById).not.toHaveBeenCalled()
    expect(iframe.playVideo).not.toHaveBeenCalled()
    expect(player.props.onLoad).not.toHaveBeenCalled()
    expect(player.props.onPlay).not.toHaveBeenCalled()
    expect(statuses).toEqual([])
    expect(onEnd).not.toHaveBeenCalled()
    expect(player.statusTimer).toBeNull()
    player.componentWillUnmount()
  })

  it('starts the prepared instance without reloading and ignores a late previous ending', () => {
    const { player, iframe, update, event, onEnd } = setup()
    update({ isActive: false, isPlaying: false, mediaKey: 2, videoId: 'second', volume: 0 })
    update({ isActive: true, isPlaying: true, volume: 0.7 })
    expect(iframe.loadVideoById).not.toHaveBeenCalled()
    expect(iframe.playVideo).toHaveBeenCalledOnce()
    expect(iframe.destroy).not.toHaveBeenCalled()
    expect(player.props.onLoad).toHaveBeenCalledOnce()
    expect(iframe.setVolume).toHaveBeenLastCalledWith(70)
    expect(iframe.setVolume.mock.invocationCallOrder[1]).toBeLessThan(iframe.playVideo.mock.invocationCallOrder[0])
    event(ENDED)
    expect(onEnd).not.toHaveBeenCalled()
    event(PLAYING)
    event(ENDED)
    expect(onEnd).toHaveBeenCalledOnce()
    player.componentWillUnmount()
  })

  it('cues the same YouTube video from the start for a different queue entry', () => {
    const { player, iframe, update } = setup()
    update({ isActive: false, isPlaying: false, mediaKey: 2 })
    expect(iframe.cueVideoById).toHaveBeenCalledWith('first')
    update({ isActive: true, isPlaying: true })
    expect(iframe.playVideo).toHaveBeenCalledOnce()
    expect(iframe.loadVideoById).not.toHaveBeenCalled()
    player.componentWillUnmount()
  })

  it('waits for the matching asynchronous CUED acknowledgement before promotion can play', () => {
    const { player, iframe, update, event } = setup()
    iframe.cueVideoById.mockImplementation(() => {})
    update({ isActive: false, isPlaying: false, mediaKey: 2, videoId: 'second' })
    update({ isActive: true, isPlaying: true })
    expect(iframe.playVideo).not.toHaveBeenCalled()
    event(5)
    expect(iframe.playVideo).not.toHaveBeenCalled()
    iframe.getVideoUrl.mockReturnValue('https://www.youtube.com/watch?v=second')
    event(5)
    expect(iframe.playVideo).toHaveBeenCalledOnce()
    expect(iframe.loadVideoById).not.toHaveBeenCalled()
    player.componentWillUnmount()
  })

  it('replaces a cancelled preparation and drops errors belonging to that item', () => {
    const { player, iframe, update, onError } = setup()
    update({ isActive: false, isPlaying: false, mediaKey: 2, videoId: 'cancelled' })
    player.handleError({ target: iframe, data: 100 })
    expect(onError).not.toHaveBeenCalled()
    update({ mediaKey: 3, videoId: 'replacement' })
    update({ isActive: true, isPlaying: true })
    expect(iframe.cueVideoById.mock.calls).toEqual([['cancelled'], ['replacement']])
    expect(iframe.playVideo).toHaveBeenCalledOnce()
    expect(onError).not.toHaveBeenCalled()
    player.componentWillUnmount()
  })

  it('reports preparation failure only after the affected item becomes active', () => {
    const { player, iframe, update, onError } = setup()
    update({ isActive: false, isPlaying: false, mediaKey: 2, videoId: 'missing' })
    player.handleError({ target: iframe, data: 100 })
    expect(onError).not.toHaveBeenCalled()
    update({ isActive: true, isPlaying: true })
    expect(onError).toHaveBeenCalledWith(expect.any(String), { category: 'iframe', code: 100 })
    expect(iframe.playVideo).not.toHaveBeenCalled()
    player.componentWillUnmount()
  })

  it('prepares the latest selection when iframe readiness arrives during the announcement', () => {
    const { player, iframe, update } = setup({ isActive: false, isPlaying: false })
    player.isReady = false
    update({ mediaKey: 2, videoId: 'second' })
    player.handleReady({ target: iframe })
    expect(iframe.cueVideoById).toHaveBeenCalledWith('second')
    expect(iframe.loadVideoById).not.toHaveBeenCalled()
    update({ isActive: true, isPlaying: true })
    expect(iframe.playVideo).toHaveBeenCalledOnce()
    player.componentWillUnmount()
  })

  it('does not seek or play a hidden preparation on replay, retries or stray playback events', () => {
    const { player, iframe, update, event, statuses } = setup()
    update({ isActive: false, isPlaying: false, mediaKey: 2, videoId: 'second' })
    update({ mediaReplayKey: 10 })
    player.retryPlayback()
    event(PLAYING)
    expect(iframe.seekTo).not.toHaveBeenCalled()
    expect(iframe.playVideo).not.toHaveBeenCalled()
    expect(iframe.pauseVideo).toHaveBeenCalledOnce()
    expect(statuses).toEqual([])
    player.componentWillUnmount()
  })

  it('preserves an explicit pause at promotion and allows a later local autoplay retry', () => {
    const { player, iframe, update, event } = setup()
    update({ isActive: false, isPlaying: false, mediaKey: 2, videoId: 'second' })
    update({ isActive: true })
    expect(iframe.playVideo).not.toHaveBeenCalled()
    update({ isPlaying: true })
    player.handleAutoplayBlocked({ target: iframe })
    expect(player.state.autoplayBlocked).toBe(true)
    player.retryPlayback()
    event(PLAYING)
    expect(player.state.autoplayBlocked).toBe(false)
    expect(player.props.isPlaying).toBe(true)
    player.componentWillUnmount()
  })

  it('can retry API loading after a failed script without reloading the page', async () => {
    vi.resetModules()
    const { default: RetryPlayer } = await import('./YouTubePlayer')
    const { player: template, onError } = setup()
    vi.stubGlobal('window', {})
    const scripts: Array<{ onerror?: () => void, remove: ReturnType<typeof vi.fn> }> = []
    let attached: object | null = null
    vi.stubGlobal('document', {
      querySelector: () => attached,
      createElement: () => {
        const script = { remove: vi.fn(() => {
          attached = null
        }) }
        scripts.push(script)
        return script
      },
      head: { appendChild: (script: object) => {
        attached = script
      } },
    })
    const first = new RetryPlayer(template.props)
    first.componentDidMount()
    scripts[0].onerror!()
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(expect.any(String), { category: 'api-load' }))
    first.componentWillUnmount()
    expect(scripts[0].remove).toHaveBeenCalledOnce()

    const retry = new RetryPlayer(template.props)
    retry.createPlayer = vi.fn()
    retry.componentDidMount()
    expect(scripts).toHaveLength(2)
    window.YT = { Player: vi.fn(), PlayerState: { PLAYING, PAUSED, ENDED } }
    window.onYouTubeIframeAPIReady!()
    await vi.waitFor(() => expect(retry.createPlayer).toHaveBeenCalledOnce())
    retry.componentWillUnmount()
  })

  it('creates only one iframe when StrictMode remounts before API loading resolves', async () => {
    const { player, iframe } = setup()
    const elements: HTMLElement[] = []
    const Player = vi.fn(function (element: HTMLElement) {
      elements.push(element)
      return iframe
    })
    vi.stubGlobal('window', {
      location: { origin: 'http://localhost:3000' },
      YT: { Player, PlayerState: { PLAYING, PAUSED, ENDED } },
    })
    const host = { replaceChildren: vi.fn() }
    vi.stubGlobal('document', { createElement: () => ({}) })
    Object.defineProperty(player.container, 'current', { value: host })
    player.player = null

    player.componentDidMount()
    player.componentWillUnmount()
    player.componentDidMount()
    await Promise.resolve()

    expect(Player).toHaveBeenCalledTimes(1)
    expect(elements[0]).not.toBe(host)
    expect(host.replaceChildren).toHaveBeenCalledWith(elements[0])
    player.componentWillUnmount()
  })

  it('waits for the current iframe readiness and applies props changed while loading', () => {
    const { player, iframe, update } = setup()
    player.isReady = false
    const staleIframe = { ...iframe }

    update({ volume: 0.4, videoId: 'second', mediaKey: 2, width: 640 })
    expect(iframe.setVolume).not.toHaveBeenCalled()
    expect(iframe.loadVideoById).not.toHaveBeenCalled()
    expect(iframe.setSize).not.toHaveBeenCalled()

    player.handleReady({ target: staleIframe })
    expect(iframe.setVolume).not.toHaveBeenCalled()
    player.handleReady({ target: iframe })
    expect(iframe.setVolume).toHaveBeenCalledWith(40)
    expect(iframe.loadVideoById).toHaveBeenCalledWith('second')
    expect(iframe.setSize).toHaveBeenCalledWith(640, 720)

    player.componentWillUnmount()
    iframe.setVolume.mockClear()
    player.handleReady({ target: iframe })
    expect(iframe.setVolume).not.toHaveBeenCalled()
  })

  it('still honors explicit Pause/Play and iframe pause after the new video starts', () => {
    const { commands, event, player, update } = setup()

    update({ mediaKey: 2, videoId: 'second' })
    event(PLAYING)
    update({ isPlaying: false })
    expect(commands).toEqual(['load:second', 'pause'])

    update({ isPlaying: true })
    expect(commands).toEqual(['load:second', 'pause', 'play'])
    event(PLAYING)
    event(PAUSED)
    expect(player.props.isPlaying).toBe(false)
    player.componentWillUnmount()
  })

  it('allows an explicit Pause during load and preserves natural completion', () => {
    const { commands, event, onEnd, player, update } = setup()

    update({ mediaKey: 2, videoId: 'second' })
    update({ isPlaying: false })
    expect(commands).toEqual(['load:second', 'pause'])
    event(ENDED)
    expect(onEnd).toHaveBeenCalledOnce()
    player.componentWillUnmount()
  })

  it('does not undo Play when a queued video reports its earlier PAUSED state', () => {
    const { commands, event, player, update } = setup()

    update({ isPlaying: false })
    update({ mediaKey: 2, videoId: 'second' })
    expect(commands).toEqual(['pause', 'cue:second'])

    update({ isPlaying: true })
    event(PAUSED)
    expect(commands).toEqual(['pause', 'cue:second', 'play'])
    expect(player.props.isPlaying).toBe(true)
    player.componentWillUnmount()
  })

  it('keeps an autoplay-blocked song available for a local retry without failing or skipping it', () => {
    const { commands, event, iframe, onEnd, onError, player } = setup()
    player.handleAutoplayBlocked({ target: iframe })
    expect(player.props.isPlaying).toBe(false)
    expect(player.state.autoplayBlocked).toBe(true)
    expect(onEnd).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()

    player.retryPlayback()
    expect(commands[commands.length - 1]).toBe('play')
    event(PAUSED)
    expect(player.awaitingPlayback).toBe(true)
    event(PLAYING)
    expect(player.props.isPlaying).toBe(true)
    expect(player.state.autoplayBlocked).toBe(false)
    player.componentWillUnmount()
  })

  it('ignores autoplay-blocked notifications from a destroyed or replaced iframe', () => {
    const { iframe, player, statuses } = setup()
    player.handleAutoplayBlocked({ target: { ...iframe } })
    player.componentWillUnmount()
    player.handleAutoplayBlocked({ target: iframe })
    expect(player.state.autoplayBlocked).toBe(false)
    expect(statuses).toEqual([])
  })

  it.each([100, 153])('passes iframe code %s separately from the display message', (code) => {
    const { player, iframe } = setup()
    player.handleError({ data: code, target: iframe })
    expect(player.props.onError).toHaveBeenCalledWith(
      code === 100 ? 'El video de YouTube no está disponible o fue eliminado (código 100)' : 'No se pudo reproducir el video de YouTube (código 153)',
      { category: 'iframe', code },
    )
  })

  it('reports API loader failures as a fixed category without forwarding exception text', async () => {
    const { player } = setup()
    vi.stubGlobal('window', { YT: undefined })
    vi.stubGlobal('document', {
      querySelector: (): null => null,
      createElement: () => ({ remove: vi.fn() }),
      head: { appendChild: (script: { onerror(): void }) => script.onerror() },
    })

    player.componentDidMount()
    await vi.waitFor(() => expect(player.props.onError).toHaveBeenCalledWith(
      'No se pudo cargar el reproductor de YouTube', { category: 'api-load' },
    ))
    player.componentWillUnmount()
  })
})
