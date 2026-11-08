import { useEffect, useMemo, useState } from 'react'
import type { PlayerDisplaySettings } from 'shared/playerDisplay'

export default function useLogoAnimation (logo: PlayerDisplaySettings['logo'], source: string, isPlaying: boolean) {
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [resource, setResource] = useState<{ source: string, blob: Blob } | null>(null)
  const [failed, setFailed] = useState('')
  const [windowState, setWindowState] = useState<{ cycle: object, animated: boolean, iteration: number } | null>(null)
  const [decoded, setDecoded] = useState<{ cycle: object, iteration: number, url: string } | null>(null)
  const load = logo.enabled && logo.source === 'custom' && logo.mode !== 'static' && !!source && !reducedMotion && failed !== source
  const animate = load && isPlaying
  const cycle = useMemo(() => ({ animate, mode: logo.mode, staticSeconds: logo.staticSeconds, animatedSeconds: logo.animatedSeconds, source }), [animate, logo.mode, logo.staticSeconds, logo.animatedSeconds, source])
  const show = animate && (logo.mode === 'animated' || (windowState?.cycle === cycle && windowState.animated))
  const iteration = logo.mode === 'animated' ? 0 : windowState?.cycle === cycle ? windowState.iteration : 0
  const blob = resource?.source === source ? resource.blob : null

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const changed = () => setReducedMotion(query.matches)
    query.addEventListener('change', changed)
    return () => query.removeEventListener('change', changed)
  }, [])

  useEffect(() => {
    if (!load || resource?.source === source) return
    const controller = new AbortController()
    let alive = true
    void fetch(source, { credentials: 'same-origin', signal: controller.signal }).then(async (response) => {
      if (!response.ok || !response.headers.get('content-type')?.startsWith('image/gif')) throw new Error('GIF unavailable')
      return response.blob()
    }).then((blob): void => {
      if (alive) setResource({ source, blob })
      return undefined
    }).catch(() => {
      if (alive && !controller.signal.aborted) setFailed(source)
    })
    return () => {
      alive = false
      controller.abort()
    }
  }, [load, source, resource?.source])

  useEffect(() => {
    if (!animate || logo.mode !== 'alternating') return
    let animated = false
    let iteration = 0
    let timer: ReturnType<typeof setTimeout>
    const tick = () => {
      animated = !animated
      if (animated) iteration++
      setWindowState({ cycle, animated, iteration })
      timer = setTimeout(tick, (animated ? Math.max(1, logo.animatedSeconds || 6) : Math.max(5, logo.staticSeconds || 60)) * 1000)
    }
    timer = setTimeout(tick, Math.max(5, logo.staticSeconds || 60) * 1000)
    return () => clearTimeout(timer)
  }, [animate, cycle, logo.mode, logo.staticSeconds, logo.animatedSeconds])

  useEffect(() => {
    if (!show || !blob) return
    let alive = true
    // A fresh local URL restarts the GIF without another HTTP download for each cycle.
    const url = URL.createObjectURL(blob)
    const image = new Image()
    image.src = url
    void image.decode().then((): void => {
      if (alive) setDecoded({ cycle, iteration, url })
      return undefined
    }).catch(() => { if (alive) setFailed(source) })
    return () => {
      alive = false
      image.src = ''
      URL.revokeObjectURL(url)
    }
  }, [show, blob, cycle, iteration, source])

  return {
    animatedSource: show && decoded?.cycle === cycle && decoded.iteration === iteration ? decoded.url : '',
    failAnimation: () => setFailed(source),
  }
}
