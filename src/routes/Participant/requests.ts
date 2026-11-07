import type { QueueItemStatus } from '../../../shared/queueLifecycle'
import type { GreetingDraft } from '../../../shared/greetings'
import { requestIntent, type RequestIntent } from '../../../shared/requestIntent'

export interface RequestReceipt {
  requestId: string
  sourceId: string
  title: string
  phase: 'sending' | 'uncertain' | 'confirmed' | 'error'
  message?: string
  code?: string
  queueId?: number
  status?: QueueItemStatus
  greeting?: GreetingDraft
  greetingId?: number
  requestIntent?: RequestIntent
}

interface Reply {
  type: string
  error?: string
  payload?: { code?: string, queueId?: number, status?: QueueItemStatus, requestId?: string, greetingId?: number, requestIntent?: RequestIntent }
}

// Keep the same identifier after a lost acknowledgment, including after a reload.
export const createRequestController = ({ storage, key, send, makeId }: {
  storage: Pick<Storage, 'getItem' | 'setItem'>
  key: string
  send: (sourceId: string, requestId: string, greeting?: GreetingDraft, intent?: RequestIntent) => Promise<Reply>
  makeId: () => string
}) => {
  let receipts: Record<string, RequestReceipt> = {}
  try {
    const saved = JSON.parse(storage.getItem(key) || '{}')
    for (const value of Object.values(saved) as RequestReceipt[]) {
      if (!value || typeof value.sourceId !== 'string' || typeof value.requestId !== 'string') continue
      const { requestId, sourceId, title, phase, message, code, queueId, status, greeting, greetingId } = value
      receipts[sourceId] = { requestId, sourceId, title, phase: phase === 'sending' ? 'uncertain' : phase, message, code, queueId, status, greeting, greetingId, requestIntent: requestIntent(value.requestIntent) }
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
    clearBlockedErrors: () => {
      if (!Object.values(receipts).some(receipt => receipt.code === 'MUSIC_BLOCKED')) return
      receipts = Object.fromEntries(Object.entries(receipts).filter(([, receipt]) => receipt.code !== 'MUSIC_BLOCKED'))
      try {
        persist()
      } catch { /* The next request still requires durable storage. */ }
      listeners.forEach(listener => listener())
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    async request (sourceId: string, title: string, greeting?: GreetingDraft | null, intent?: RequestIntent) {
      const previous = receipts[sourceId]
      if (previous?.phase === 'sending') return
      const receipt: RequestReceipt = {
        sourceId, title,
        requestId: previous && previous.phase !== 'confirmed' ? previous.requestId : makeId(),
        phase: 'sending',
        greeting: previous?.phase === 'uncertain' ? previous.greeting : greeting === null ? undefined : greeting ?? (previous?.phase === 'error' ? previous.greeting : undefined),
        requestIntent: previous?.phase === 'uncertain' ? previous.requestIntent : intent ?? previous?.requestIntent ?? 'UNKNOWN',
      }
      update(receipt)
      try {
        persist()
      } catch {
        update({ ...receipt, phase: 'error', message: 'Permite el almacenamiento del navegador para enviar tu pedido.' })
        return receipts[sourceId]
      }
      try {
        const response = await send(sourceId, receipt.requestId, receipt.greeting, receipt.requestIntent)
        if (response.error) update({ ...receipt, phase: 'error', message: response.error, code: response.payload?.code })
        else if (response.payload?.requestId === receipt.requestId) {
          // The acknowledgment also carries the room queue; only persist the receipt.
          const { queueId, status, greetingId } = response.payload
          update({ ...receipt, queueId, status, greetingId, requestIntent: response.payload.requestIntent ?? receipt.requestIntent, phase: 'confirmed' })
        } else update({ ...receipt, phase: 'uncertain' })
      } catch {
        update({ ...receipt, phase: 'uncertain' })
      }
      try {
        persist()
      } catch { /* The durable sending record still retains the identifier. */ }
      return receipts[sourceId]
    },
  }
}
