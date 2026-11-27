import socket from '../../lib/socket'
import { GREETINGS, type GreetingGrant, type GreetingSnapshot, type GreetingPreparation } from '../../../shared/greetings'

export async function greetingRequest (operation: string, payload: object = {}, now = Date.now()) {
  if (!socket.connected) throw new Error('Sin conexión. Espera a reconectar.')
  // Settings and polling tolerate network latency without extending player deadlines.
  const timeout = ['read', 'attach', 'prepareAudio', 'playback'].includes(operation) ? 5000 : 1500
  let reply: { error?: string, code?: string, payload?: GreetingSnapshot, grant?: GreetingGrant | null, preparation?: GreetingPreparation | null }
  try {
    reply = await socket.timeout(timeout).emitWithAck('action', {
      type: GREETINGS, payload: { ...payload, operation, expiresAt: now + Math.max(3000, timeout) },
    })
  } catch {
    throw Object.assign(new Error('No llegó la confirmación del servidor. Revise el estado antes de repetir.'), { uncertain: true })
  }
  if (reply.error) throw Object.assign(new Error(reply.error), { code: reply.code })
  return reply
}
