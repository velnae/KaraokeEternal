type Celebration = 'none' | 'waiting' | 'finished' | 'interrupted'

/** Local ownership at the boundary; the server still owns birthday and ambience permits. */
export function createRoomBoundary () {
  let owner: AbortController | null = null
  let idle: Promise<void> | undefined

  const begin = () => {
    owner?.abort()
    const run = new AbortController()
    owner = run
    const current = () => owner === run && !run.signal.aborted
    const yieldIdle = async (stop: () => Promise<void>) => {
      const pending = idle
      await stop()
      await pending
      return current()
    }
    return {
      current, yieldIdle,
      async celebrate (release: () => Promise<void>, play: (signal: AbortSignal) => Promise<Celebration>): Promise<Celebration> {
        if (!current() || !await yieldIdle(release)) return 'interrupted'
        const result = await play(run.signal)
        return current() ? result : 'interrupted'
      },
      close () {
        if (owner === run) owner = null
        run.abort()
      },
    }
  }
  const enterIdle = (play: () => Promise<void>) => {
    if (owner || idle) return
    idle = play().finally(() => {
      idle = undefined
    })
  }
  return { begin, enterIdle, cancel: () => owner?.abort() }
}
