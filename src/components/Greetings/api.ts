import socket from '../../lib/socket'
import { GREETINGS, type GreetingGrant, type GreetingSnapshot, type GreetingPreparation } from '../../../shared/greetings'

export async function greetingRequest (operation: string, payload: object = {}) {
  if (!socket.connected) throw new Error('Sin conexión. Espera a reconectar.')
  // Settings and polling tolerate network latency without extending player deadlines.
  const timeout = ['read', 'prepareAudio', 'playback'].includes(operation) ? 5000 : 1500
  let reply: { error?: string, payload?: GreetingSnapshot, grant?: GreetingGrant | null, preparation?: GreetingPreparation | null }
  try {
    reply = await socket.timeout(timeout).emitWithAck('action', {
      type: GREETINGS, payload: { ...payload, operation, expiresAt: Date.now() + Math.max(2000, timeout) },
    })
  } catch {
    throw new Error('No llegó la confirmación del servidor. Revise el estado antes de repetir.')
  }
  if (reply.error) throw new Error(reply.error)
  return reply
}
