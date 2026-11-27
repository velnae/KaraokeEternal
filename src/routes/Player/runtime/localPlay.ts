// Local controls share the current mounted player's synchronous gesture handler.
// Remote operator controls keep using the room command directly.
interface StartPorts {
  scope(): string | null
  hasIntent(): boolean
  activate(): void
  request(): void
}

export function createLocalPlay (now = () => performance.now()) {
  let ports: StartPorts | undefined
  let media: ((scope: string) => boolean) | undefined
  let pending: { scope: string, until: number } | undefined
  let generation = 0
  const currentScope = () => {
    const value = ports?.scope()
    return value ? `${generation}/${value}` : null
  }
  function start (recoveryOnly: boolean) {
    const scope = currentScope()
    if (!ports || !scope) return
    ports.activate()
    if (media?.(scope) || recoveryOnly || ports.hasIntent()) return
    if (pending?.scope === scope && now() < pending.until) return
    // No timer or network completion dispatches playback; only a new gesture
    // may retry an unanswered request after the coalescing window.
    pending = { scope, until: now() + 3000 }
    ports.request()
  }
  return {
    bind (current: StartPorts) {
      ports = current
      generation++
      pending = undefined
      return () => {
        if (ports === current) ports = undefined
      }
    },
    bindMedia (callback: (scope: string) => boolean) {
      media = callback
      return () => {
        if (media === callback) media = undefined
      }
    },
    scope: currentScope,
    reset () {
      generation++
      pending = undefined
    },
    start: () => start(false),
    recover: () => start(true),
  }
}

export const localPlay = createLocalPlay()
