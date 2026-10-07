import type { QueueItem } from '../../../shared/types'

export const requestStatusLabels = {
  PENDING_APPROVAL: 'Por aprobar',
  APPROVED: 'En la cola',
  PLAYING: 'Cantando ahora',
  PLAYED: 'Finalizada',
  REJECTED: 'No aprobada',
  FAILED: 'No se pudo reproducir',
  REMOVED: 'Cancelada',
} as const

export const isPendingRequest = (item: QueueItem) => item.origin === 'PARTICIPANT'
  && (item.status === 'PENDING_APPROVAL' || item.status === 'APPROVED')

export const requestPriority = (item: QueueItem) => item.status === 'PLAYING' ? 2 : isPendingRequest(item) ? 1 : 0

export const estimatedWait = (before: QueueItem[], currentId: number, position: number): number | null => {
  let seconds = 0
  for (const item of before) {
    if (item.durationSeconds === null || !Number.isFinite(item.durationSeconds) || item.durationSeconds <= 0) return null
    seconds += Math.max(0, item.durationSeconds - (item.queueId === currentId ? position : 0))
  }
  return Math.ceil(seconds / 60)
}

export const karaokeQuery = (query: string, karaoke: boolean) => {
  const trimmed = query.trim()
  return karaoke && !/\bkaraoke\b/i.test(trimmed) ? `${trimmed} karaoke` : trimmed
}
