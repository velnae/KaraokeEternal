import socket from 'lib/socket'
import { GREETINGS, type GreetingGrant, type GreetingSnapshot } from 'shared/greetings'

export async function greetingRequest (operation: string, payload: object = {}) {
  if (!socket.connected) throw new Error('Sin conexión. Espera a reconectar.')
  const reply: { error?: string, payload?: GreetingSnapshot, grant?: GreetingGrant | null } = await socket.timeout(1500).emitWithAck('action', {
    type: GREETINGS, payload: { operation, expiresAt: Date.now() + 2000, ...payload },
  })
  if (reply.error) throw new Error(reply.error)
  return reply
}
