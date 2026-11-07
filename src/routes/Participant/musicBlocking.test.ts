import { expect, it, vi } from 'vitest'
import { createRequestController } from './requests'

it('persists policy failures, then allows a new attempt after rules change without disturbing uncertain receipts', async () => {
  let saved = '{}'
  const storage = {
    getItem: () => saved,
    setItem: (_key: string, value: string) => { saved = value },
  }
  const send = vi.fn().mockResolvedValue({ type: 'ERROR', error: 'Política del local', payload: { code: 'MUSIC_BLOCKED' } })
  const options = { storage, key: 'requests', send, makeId: () => 'request-0000000001' }
  const controller = createRequestController(options)
  await controller.request('fixture0001', 'Song')
  const restored = createRequestController(options)
  expect(restored.getSnapshot().fixture0001).toMatchObject({ phase: 'error', code: 'MUSIC_BLOCKED' })
  send.mockRejectedValueOnce(new Error('offline'))
  await restored.request('fixture0002', 'Other')
  restored.clearBlockedErrors()
  expect(restored.getSnapshot().fixture0001).toBeUndefined()
  expect(restored.getSnapshot().fixture0002.phase).toBe('uncertain')
  send.mockResolvedValue({ type: 'SUCCESS', payload: { requestId: 'request-0000000001', queueId: 1, status: 'APPROVED' } })
  await restored.request('fixture0001', 'Song')
  expect(restored.getSnapshot().fixture0001.phase).toBe('confirmed')
})
