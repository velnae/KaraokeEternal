import { describe, expect, it, vi } from 'vitest'
import { createRequestController } from './requests'

const fixture = () => {
  let saved = ''
  const storage = {
    getItem: () => saved,
    setItem: (_: string, value: string) => { saved = value },
  }
  const send = vi.fn().mockResolvedValue({ type: 'ok', payload: { requestId: 'request-0000000001', queueId: 1, status: 'APPROVED' } })
  const options = { storage, key: 'test', send, makeId: () => 'request-0000000001' }
  return { options, send, controller: createRequestController(options) }
}

describe('mobile request confirmation', () => {
  it('freezes singing intent together with the greeting after a lost acknowledgment', async () => {
    const { controller, options, send } = fixture()
    send.mockRejectedValueOnce(new Error('timeout'))
    await controller.request('video', 'Song', { message: 'Hello' }, 'SING')
    const restored = createRequestController(options)
    await restored.request('video', 'Song', null, 'LISTEN')
    expect(send.mock.calls.map(call => call[3])).toEqual(['SING', 'SING'])
    expect(restored.getSnapshot().video.requestIntent).toBe('SING')
  })
  it('freezes a greeting through an uncertain acknowledgment and reload', async () => {
    const { controller, options, send } = fixture()
    const greeting = { message: 'Feliz cumpleaños' }
    send.mockRejectedValueOnce(new Error('timeout'))
    await controller.request('video', 'Song', greeting)
    const restored = createRequestController(options)
    expect(restored.getSnapshot().video.greeting).toEqual(greeting)
    await restored.request('video', 'Song', { message: 'Changed' })
    expect(send.mock.calls.map(call => call[2])).toEqual([greeting, greeting])
  })

  it('allows a rejected draft to be retried without a greeting', async () => {
    const { controller, send } = fixture()
    send.mockResolvedValueOnce({ error: 'La ventana cerró' })
    await controller.request('video', 'Song', { message: 'Hello' })
    await controller.request('video', 'Song', null)
    expect(send.mock.calls[1][2]).toBeUndefined()
    expect(controller.getSnapshot().video.phase).toBe('confirmed')
  })
  it('blocks rapid double taps and confirms only after a matching acknowledgment', async () => {
    const { controller, send } = fixture()
    const pending = controller.request('video', 'Song')
    expect(controller.getSnapshot().video.phase).toBe('sending')
    await controller.request('video', 'Song')
    expect(await pending).toMatchObject({ phase: 'confirmed', queueId: 1 })
    expect(send).toHaveBeenCalledOnce()
    expect(controller.getSnapshot().video).toMatchObject({ phase: 'confirmed', queueId: 1 })
  })

  it('retains the original identifier after a timeout and page reload', async () => {
    const { controller, options, send } = fixture()
    send.mockRejectedValueOnce(new Error('timeout'))
    await controller.request('video', 'Song')
    expect(controller.getSnapshot().video.phase).toBe('uncertain')
    const restored = createRequestController({ ...options, makeId: () => 'must-not-create-another' })
    await restored.request('video', 'Song')
    expect(send.mock.calls).toEqual([['video', 'request-0000000001', undefined, 'UNKNOWN'], ['video', 'request-0000000001', undefined, 'UNKNOWN']])
    expect(restored.getSnapshot().video.phase).toBe('confirmed')
  })

  it('restores an interrupted sending operation as uncertain', async () => {
    const { controller, options, send } = fixture()
    send.mockReturnValue(new Promise(() => {}))
    void controller.request('video', 'Song')
    expect(createRequestController(options).getSnapshot().video.phase).toBe('uncertain')
  })

  it('shows server errors without claiming success', async () => {
    const { controller, send } = fixture()
    send.mockResolvedValue({ type: 'error', error: 'Límite alcanzado' })
    expect(await controller.request('video', 'Song')).toMatchObject({ phase: 'error' })
    expect(controller.getSnapshot().video).toMatchObject({ phase: 'error', message: 'Límite alcanzado' })
  })

  it('returns uncertainty instead of a navigation target after a lost acknowledgement', async () => {
    const { controller, send } = fixture()
    send.mockRejectedValueOnce(new Error('timeout'))
    expect(await controller.request('video', 'Song')).toMatchObject({ phase: 'uncertain' })
    expect(await controller.request('video', 'Song')).toMatchObject({ phase: 'confirmed', queueId: 1 })
    expect(send.mock.calls.map(call => call[1])).toEqual(['request-0000000001', 'request-0000000001'])
  })

  it('keeps room snapshots out of durable receipts, including older saved entries', async () => {
    const { controller, options, send } = fixture()
    const queue = { result: [1], entities: { 1: { title: 'Another participant song' } } }
    send.mockResolvedValue({ type: 'ok', payload: { requestId: 'request-0000000001', queueId: 1, status: 'APPROVED', queue } })
    await controller.request('video', 'Song')
    const saved = JSON.parse(options.storage.getItem())
    expect(saved.video).not.toHaveProperty('queue')
    expect(saved.video).toMatchObject({ requestId: 'request-0000000001', queueId: 1, phase: 'confirmed' })

    options.storage.setItem('test', JSON.stringify({ video: { ...saved.video, queue } }))
    const restored = createRequestController(options).getSnapshot().video
    expect(restored).not.toHaveProperty('queue')
    expect(restored).toMatchObject({ requestId: 'request-0000000001', queueId: 1, phase: 'confirmed' })
  })

  it('does not send when the request identity cannot be saved', async () => {
    const { options, send } = fixture()
    options.storage.setItem = () => {
      throw new Error('storage denied')
    }
    const controller = createRequestController(options)
    await controller.request('video', 'Song')
    expect(send).not.toHaveBeenCalled()
    expect(controller.getSnapshot().video.phase).toBe('error')
  })
})
