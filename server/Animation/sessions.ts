import { randomUUID } from 'node:crypto'
import { db } from '../lib/Database.js'
import type { AnimationSession, VoiceFamily } from '../../shared/animation.js'

export interface PendingEvent { family: VoiceFamily, key: string, expiresAt: number }
export function businessDate (now: number, cutoffHour: number) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now - cutoffHour * 3600000))
}
export const currentSession = (roomId: number) => db.get<AnimationSession>('SELECT * FROM animationSessions WHERE roomId=? AND status!=\'CLOSED\'', [roomId]) ?? null
export function pendingEvent (roomId: number): PendingEvent | null {
  const value = db.get<{ pendingEventJSON: string | null }>('SELECT pendingEventJSON FROM animationRoomState WHERE roomId=?', [roomId])?.pendingEventJSON
  return value ? JSON.parse(value) : null
}
export function setSignal (roomId: number, family: VoiceFamily, key: string, expiresAt: number) {
  db.run('UPDATE animationRoomState SET pendingEventJSON=? WHERE roomId=?', [JSON.stringify({ family, key, expiresAt }), roomId])
}
export function operateSession (roomId: number, actor: number, operation: 'open' | 'close' | 'finish' | 'celebrate', cutoffHour: number) {
  const session = currentSession(roomId)
  const now = Date.now()
  if (operation === 'open') {
    if (session) return session
    const id = randomUUID()
    db.run('INSERT INTO animationSessions(sessionId,roomId,status,openedAt,businessDate,openedBy) VALUES(?,?,\'OPEN\',?,?,?)', [id, roomId, now, businessDate(now, cutoffHour), actor])
    setSignal(roomId, 'welcome', `${id}:welcome`, now + 120000)
  } else {
    if (!session) throw new Error('Inicie una jornada primero.')
    if (operation === 'celebrate') {
      if (session.status !== 'OPEN') throw new Error('La jornada está cerrándose.')
      const pending = pendingEvent(roomId)
      if (pending?.family === 'celebration' && pending.expiresAt > now) throw new Error('Ya hay una celebración pendiente.')
      setSignal(roomId, 'celebration', `${session.sessionId}:celebration:${randomUUID()}`, now + 120000)
    } else if (operation === 'close') {
      if (session.status === 'CLOSING') return session
      db.run('UPDATE animationSessions SET status=\'CLOSING\',closingDeadline=? WHERE sessionId=?', [now + 60000, session.sessionId])
      setSignal(roomId, 'goodbye', `${session.sessionId}:goodbye`, now + 60000)
    } else {
      db.run('UPDATE animationSessions SET status=\'CLOSED\',closedAt=? WHERE sessionId=?', [now, session.sessionId])
      db.run('UPDATE animationRoomState SET pendingEventJSON=NULL WHERE roomId=?', [roomId])
    }
  }
  return currentSession(roomId)
}
