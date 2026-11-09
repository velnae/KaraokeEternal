import { db } from '../lib/Database.js'
import { canOperate } from '../../shared/permissions.js'
import Tables, { newToken, tableLabel } from './Tables.js'
import { TABLE_ACCESS_REQUIRED, tableMode, type TableContext } from '../../shared/tableAccess.js'
import type { IRoomPrefs } from '../../shared/types.js'
import type { Server, Socket } from 'socket.io'

export const PARTICIPATION_TTL_SECONDS = 12 * 60 * 60
const now = () => Math.floor(Date.now() / 1000)
export const emptyTableContext = (): TableContext => ({ participantSessionId: null, tableId: null, tableLabel: null, expiresAt: null })
type Identity = { userId: number, roomId: number, role?: string, isAdmin?: boolean, participantSessionId?: string | null }

export function validateInvitation (roomId: number, invitation?: unknown, isAdmin = false) {
  if (isAdmin) return null
  const room = Tables.room(roomId)
  if (room.status !== 'open') throw new Error('La sala está cerrada')
  if (invitation) {
    const resolved = Tables.resolve(invitation)
    if (resolved.roomId !== roomId) throw new Error('El QR pertenece a otra sala')
    return resolved
  }
  if (tableMode(room.prefs) === 'REQUIRED_QR') throw new Error('Escanee el QR de su mesa para entrar como cantante')
  return null
}

export function participation (user: Identity, savedRoom?: { status: string, prefs: IRoomPrefs }): TableContext {
  if (canOperate(user)) return emptyTableContext()
  const room = savedRoom ?? Tables.room(user.roomId)
  if (room.status !== 'open') throw new Error('La sala está cerrada')
  if (user.participantSessionId) {
    const session = db.get<{ tableId: number, expiresAt: number }>(`SELECT s.tableId, s.expiresAt FROM participantSessions s
      JOIN roomTables t ON t.tableId = s.tableId AND t.roomId = s.roomId
      WHERE s.participantSessionId = ? AND s.userId = ? AND s.roomId = ?
      AND s.revokedAt IS NULL AND s.expiresAt > ? AND t.status = 'active'`, [user.participantSessionId, user.userId, user.roomId, now()])
    if (!session) throw new Error('Su acceso a la mesa terminó. Escanee nuevamente el QR de su mesa.')
    if (tableMode(room.prefs) === 'OFF') return { ...emptyTableContext(), expiresAt: session.expiresAt }
    return { participantSessionId: user.participantSessionId, tableId: session.tableId, tableLabel: tableLabel(Tables.get(user.roomId, session.tableId)), expiresAt: session.expiresAt }
  }
  if (tableMode(room.prefs) === 'REQUIRED_QR') throw new Error('Escanee el QR de su mesa para continuar')
  return emptyTableContext()
}

export function revokeParticipation (sessionId?: string | null) {
  if (sessionId) db.run('UPDATE participantSessions SET revokedAt = ? WHERE participantSessionId = ? AND revokedAt IS NULL', [now(), sessionId])
}

// Call after all asynchronous credential checks. This operation never yields.
export function joinTable (user: Identity, invitation?: unknown): TableContext {
  const target = validateInvitation(user.roomId, invitation, canOperate(user))
  if (!target) {
    revokeParticipation(user.participantSessionId)
    return emptyTableContext()
  }
  try {
    const current = participation(user)
    if (current.tableId === target.tableId) return current
  } catch { /* A valid invitation can recover expired participation. */ }
  const participantSessionId = newToken()
  const expiresAt = now() + PARTICIPATION_TTL_SECONDS
  db.exec('SAVEPOINT table_join')
  try {
    revokeParticipation(user.participantSessionId)
    db.run('INSERT INTO participantSessions(participantSessionId, userId, roomId, tableId, dateCreated, expiresAt) VALUES (?, ?, ?, ?, ?, ?)', [participantSessionId, user.userId, user.roomId, target.tableId, now(), expiresAt])
    db.exec('RELEASE table_join')
  } catch (error) {
    db.exec('ROLLBACK TO table_join')
    db.exec('RELEASE table_join')
    throw error
  }
  return { participantSessionId, tableId: target.tableId, tableLabel: target.tableLabel, expiresAt }
}

export function enforceConnectedParticipants (io: Server) {
  if (!io) return
  for (const connection of io.of('/').sockets.values()) {
    const socket = connection as Socket & { user?: Identity }
    if (!socket.user || canOperate(socket.user)) continue
    try {
      participation(socket.user)
    } catch (error) {
      socket.emit('action', { type: TABLE_ACCESS_REQUIRED, payload: (error as Error).message })
      socket.disconnect(true)
    }
  }
}
