import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { greetingRequest } from './api'
import socket from '../../lib/socket'

vi.mock('../../lib/socket', () => ({ default: { connected: true, timeout: vi.fn() } }))

const emitWithAck = vi.fn()
beforeEach(() => {
  vi.useFakeTimers()
  socket.connected = true
  vi.mocked(socket.timeout).mockImplementation(() => ({ emitWithAck }) as unknown as typeof socket)
})
afterEach(() => {
  vi.useRealTimers()
  vi.resetAllMocks()
})

it.each(['read', 'attach', 'prepareAudio', 'playback'])('accepts a delayed %s confirmation without expiring the command early', async (operation) => {
  const now = Date.now()
  emitWithAck.mockImplementation((_event, action) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('operation has timed out')), vi.mocked(socket.timeout).mock.lastCall![0])
    setTimeout(() => {
      clearTimeout(timer)
      resolve(action.payload.expiresAt < Date.now() ? { error: 'La orden venció.' } : { payload: { audioEnabled: true } })
    }, 2200)
  }))
  const response = greetingRequest(operation, { enabled: true })
  const assertion = expect(response).resolves.toEqual({ payload: { audioEnabled: true } })
  await vi.advanceTimersByTimeAsync(2200)
  await assertion
  expect(emitWithAck.mock.calls[0][1].payload.expiresAt).toBe(now + 5000)
})

it('keeps player reservations bounded and explains missing confirmation without retrying', async () => {
  emitWithAck.mockImplementation(() => new Promise((_resolve, reject) => {
    setTimeout(() => reject(new Error('operation has timed out')), vi.mocked(socket.timeout).mock.lastCall![0])
  }))
  const response = greetingRequest('reserve', { queueId: 1 })
  const assertion = expect(response).rejects.toThrow('No llegó la confirmación del servidor. Revise el estado antes de repetir.')
  await vi.advanceTimersByTimeAsync(1500)
  await assertion
  expect(emitWithAck).toHaveBeenCalledTimes(1)
})

it('bounds settings confirmation and preserves explicit server errors', async () => {
  emitWithAck.mockImplementationOnce(() => new Promise((_resolve, reject) => {
    setTimeout(() => reject(new Error('operation has timed out')), vi.mocked(socket.timeout).mock.lastCall![0])
  }))
  const assertion = expect(greetingRequest('prepareAudio', { enabled: true })).rejects.toThrow('Revise el estado antes de repetir.')
  await vi.advanceTimersByTimeAsync(5000)
  await assertion
  expect(emitWithAck).toHaveBeenCalledTimes(1)
  emitWithAck.mockResolvedValueOnce({ error: 'Solo el operador puede configurar la preparación de voz' })
  await expect(greetingRequest('prepareAudio', { enabled: true })).rejects.toThrow('Solo el operador')
})

it('does not queue commands while disconnected', async () => {
  socket.connected = false
  await expect(greetingRequest('prepareAudio', { enabled: true })).rejects.toThrow('Sin conexión')
  expect(emitWithAck).not.toHaveBeenCalled()
})
