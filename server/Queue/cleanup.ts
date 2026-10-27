import { db } from '../lib/Database.js'
import Queue from './Queue.js'
import Playlists from '../Playlists/Playlists.js'
import type { QueueCleanupRequest, QueueCleanupResult } from '../../shared/queueCleanup.js'

interface Receipt extends QueueCleanupResult { actorId: number, throughQueueId: number }

export function cleanupReceipt (roomId: number, actorId: number, input: QueueCleanupRequest): QueueCleanupResult | null {
  const row = db.get<Receipt>('SELECT * FROM queueCleanupReceipts WHERE roomId=? AND requestId=?', [roomId, input.requestId])
  if (!row) return null
  if (row.actorId !== actorId || row.operation !== input.operation || row.throughQueueId !== input.throughQueueId) throw new Error('El identificador pertenece a otra operación')
  return { operation: row.operation, requestId: row.requestId, changedCount: row.changedCount, houseStopped: !!row.houseStopped }
}

export function cleanupQueue (roomId: number, actorId: number, input: QueueCleanupRequest, currentQueueId = -1): QueueCleanupResult {
  if (!Number.isSafeInteger(roomId) || !db.get('SELECT roomId FROM rooms WHERE roomId=?', [roomId])) throw new Error('La sala no existe')
  db.exec('BEGIN IMMEDIATE')
  try {
    const previous = cleanupReceipt(roomId, actorId, input)
    if (previous) {
      db.exec('COMMIT')
      return previous
    }
    const now = Date.now()
    if (!Number.isFinite(input.expiresAt) || input.expiresAt <= now || input.expiresAt > now + 60000) throw new Error('La confirmación venció. Vuelve a confirmar la limpieza.')
    let changedCount = 0
    let houseStopped = false
    if (input.operation === 'pending') {
      houseStopped = Playlists.suspendForQueueCleanup(roomId, currentQueueId)
      db.run('INSERT INTO queueCleanupState(roomId,generation) VALUES(?,1) ON CONFLICT(roomId) DO UPDATE SET generation=generation+1', [roomId])
      const rows = db.all<{ queueId: number }>(`SELECT queueId FROM queue WHERE roomId=? AND status IN ('PENDING_APPROVAL','APPROVED')
        AND queueId!=? AND (queueId<=? OR houseRunId IS NOT NULL) ORDER BY queueId`, [roomId, currentQueueId, input.throughQueueId])
      for (const row of rows) Queue.remove(row.queueId, roomId, true)
      changedCount = rows.length
    } else {
      changedCount = Number(db.run(`UPDATE queue SET historyClearedAt=? WHERE roomId=? AND queueId<=? AND queueId!=?
        AND historyClearedAt IS NULL AND status IN ('PLAYED','FAILED','REJECTED')`, [now, roomId, input.throughQueueId, currentQueueId]).changes)
    }
    db.run(`INSERT INTO queueCleanupReceipts(roomId,requestId,actorId,operation,throughQueueId,changedCount,houseStopped,createdAt)
      VALUES(?,?,?,?,?,?,?,?)`, [roomId, input.requestId, actorId, input.operation, input.throughQueueId, changedCount, Number(houseStopped), now])
    db.exec('COMMIT')
    return { operation: input.operation, requestId: input.requestId, changedCount, houseStopped }
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
