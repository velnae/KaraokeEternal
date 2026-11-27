import getLogger from './Log.js'

export function transitionReservationTrace (id: unknown, operation: string, roomId: number, queue: unknown) {
  if (process.env.NODE_ENV !== 'development' || typeof id !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)) return undefined
  const queueId = typeof queue === 'number' && Number.isSafeInteger(queue) ? queue : null
  const start = performance.now()
  return (outcome: 'ready' | 'no-audio' | 'rejected', interventionId?: string) => {
    const elapsedMs = Math.round(performance.now() - start)
    if (outcome === 'ready' && elapsedMs < 1000) return
    getLogger('transition').warn('Diagnostic %s', JSON.stringify({ diagnosticId: id, operation, roomId, queueId, outcome, elapsedMs, interventionId }))
  }
}
