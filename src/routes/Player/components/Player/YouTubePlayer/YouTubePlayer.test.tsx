import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type React from 'react'
import YouTubePlayer from './YouTubePlayer'

// The Node harness calls the class lifecycle directly rather than mounting a DOM.
vi.mock('react', () => ({
  default: {
    Component: class {
      props: unknown
      constructor (props: unknown) { this.props = props }
    },
    createRef: () => ({ current: null as HTMLElement | null }),
  },
}))

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
  })

  const setup = () => {
    const commands: string[] = []
    const statuses: Array<{ isPlaying?: boolean, position?: number }> = []
    const onEnd = vi.fn()
    const onError = vi.fn()
    const iframe = {
      loadVideoById: vi.fn((id: string) => {
        commands.push(`load:${id}`)
        // The old video's PAUSED notification may arrive during the new load.
        player.handleStateChange({ data: PAUSED, target: iframe })
      }),
      cueVideoById: vi.fn((id: string) => commands.push(`cue:${id}`)),
      pauseVideo: vi.fn(() => commands.push('pause')),
      playVideo: vi.fn(() => commands.push('play')),
      destroy: vi.fn(),
      seekTo: vi.fn(),
      setSize: vi.fn(),
      setVolume: vi.fn(),
      getCurrentTime: vi.fn(() => 0),
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
    const player = new YouTubePlayer(makeProps())
    player.player = iframe as unknown as NonNullable<typeof player.player>

    const update = (changes: Partial<Props>) => {
      const previous = player.props
      Object.defineProperty(player, 'props', {
        configurable: true,
        value: { ...previous, ...changes },
      })
      player.componentDidUpdate(previous)
    }
    const event = (data: number) => player.handleStateChange({ data, target: iframe })

    return { commands, event, iframe, onEnd, player, statuses, update }
  }

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
      createElement: () => ({}),
      head: { appendChild: (script: { onerror(): void }) => script.onerror() },
    })

    player.componentDidMount()
    await vi.waitFor(() => expect(player.props.onError).toHaveBeenCalledWith(
      'No se pudo cargar el reproductor de YouTube', { category: 'api-load' },
    ))
    player.componentWillUnmount()
  })
})
