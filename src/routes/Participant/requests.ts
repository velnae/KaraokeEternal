import type { QueueItemStatus } from '../../../shared/queueLifecycle'

export interface RequestReceipt {
  requestId: string
  sourceId: string
  title: string
  phase: 'sending' | 'uncertain' | 'confirmed' | 'error'
  message?: string
  queueId?: number
  status?: QueueItemStatus
}

interface Reply {
  type: string
  error?: string
  payload?: { queueId: number, status: QueueItemStatus, requestId: string }
}

// Keep the same identifier after a lost acknowledgment, including after a reload.
export const createRequestController = ({ storage, key, send, makeId }: {
  storage: Pick<Storage, 'getItem' | 'setItem'>
  key: string
  send: (sourceId: string, requestId: string) => Promise<Reply>
  makeId: () => string
}) => {
  let receipts: Record<string, RequestReceipt> = {}
  try {
    const saved = JSON.parse(storage.getItem(key) || '{}')
    for (const value of Object.values(saved) as RequestReceipt[]) {
      if (!value || typeof value.sourceId !== 'string' || typeof value.requestId !== 'string') continue
      const { requestId, sourceId, title, phase, message, queueId, status } = value
      receipts[sourceId] = { requestId, sourceId, title, phase: phase === 'sending' ? 'uncertain' : phase, message, queueId, status }
    }
  } catch { /* Storage may be unavailable; do not send until persistence succeeds. */ }
  const listeners = new Set<() => void>()
  const update = (receipt: RequestReceipt) => {
    receipts = { ...receipts, [receipt.sourceId]: receipt }
    listeners.forEach(listener => listener())
  }
  const persist = () => storage.setItem(key, JSON.stringify(receipts))

  return {
    getSnapshot: () => receipts,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    async request (sourceId: string, title: string) {
      const previous = receipts[sourceId]
      if (previous?.phase === 'sending') return
      const receipt: RequestReceipt = {
        sourceId, title,
        requestId: previous && previous.phase !== 'confirmed' ? previous.requestId : makeId(),
        phase: 'sending',
      }
      update(receipt)
      try {
        persist()
      } catch {
        update({ ...receipt, phase: 'error', message: 'Permite el almacenamiento del navegador para enviar tu pedido.' })
        return
      }
      try {
        const response = await send(sourceId, receipt.requestId)
        if (response.error) update({ ...receipt, phase: 'error', message: response.error })
        else if (response.payload?.requestId === receipt.requestId) {
          // The acknowledgment also carries the room queue; only persist the receipt.
          const { queueId, status } = response.payload
          update({ ...receipt, queueId, status, phase: 'confirmed' })
        } else update({ ...receipt, phase: 'uncertain' })
      } catch {
        update({ ...receipt, phase: 'uncertain' })
      }
      try {
        persist()
      } catch { /* The durable sending record still retains the identifier. */ }
    },
  }
}
