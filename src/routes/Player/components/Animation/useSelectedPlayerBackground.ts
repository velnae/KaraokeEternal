import { useEffect, useState } from 'react'
import { getTransitionVideoResource } from 'lib/transitionVideoApi'
import type { TransitionVideo, TransitionVideoBackground, TransitionVideoPrefs } from 'shared/transitionVideo'

export default function useSelectedPlayerBackground (roomId: number | null, prefs: TransitionVideoPrefs | undefined, enabled: boolean): TransitionVideoBackground | null {
  const [resource, setResource] = useState<TransitionVideo | null>(null)
  const videoId = prefs?.mode === 'all' ? null : prefs?.videoId
  useEffect(() => {
    if (!enabled || !videoId || roomId === null) return
    const controller = new AbortController()
    void getTransitionVideoResource(videoId, controller.signal).then((video): void => {
      if (!controller.signal.aborted && video.roomId === roomId && video.state === 'ready' && video.active !== false) setResource(video)
      return undefined
    }).catch(() => { /* Visual failure must never hold the music queue. */ })
    return () => controller.abort()
  }, [enabled, videoId, roomId])
  return enabled && prefs && resource?.id === videoId && resource?.roomId === roomId
    ? { resource, dimOpacity: prefs.dimOpacity, revision: prefs.revision }
    : null
}
