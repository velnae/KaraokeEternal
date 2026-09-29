import path from 'path'
import { db } from '../lib/Database.js'
import sql from 'sqlate'
import { QueueItem } from '../../shared/types.js'
import {
  canTransitionQueueItem,
  type QueueItemOrigin,
  type QueueItemStatus,
  type SongSource,
} from '../../shared/queueLifecycle.js'
import { getResolvedSongValidationError, type ResolvedSong } from '../../shared/songSource.js'

const HIDDEN_QUEUE_STATUSES = ['REJECTED', 'REMOVED']

class Queue {
  /**
   * Add a validated, resolved song snapshot to a room's queue.
   */
  static add ({
    roomId,
    song,
    userId,
    origin = 'PARTICIPANT',
    status = 'APPROVED',
  }: {
    roomId: number
    song: ResolvedSong
    userId: number
    origin?: QueueItemOrigin
    status?: 'PENDING_APPROVAL' | 'APPROVED'
  }): void {
    const validationError = getResolvedSongValidationError(song)
    if (validationError) throw new Error(validationError)
    if (!song.isPlayable) throw new Error('La canción no se puede reproducir')

    const fields = new Map()
    const now = Math.floor(Date.now() / 1000)
    fields.set('roomId', roomId)
    fields.set('songId', song.localSongId)
    fields.set('userId', userId)
    fields.set('prevQueueId', sql`(
      SELECT queueId
      FROM queue
      WHERE roomId = ${roomId}
        AND status NOT IN ${sql.tuple(HIDDEN_QUEUE_STATUSES)}
        AND queueId NOT IN (
        SELECT prevQueueId
        FROM queue
        WHERE prevQueueId IS NOT NULL AND status NOT IN ${sql.tuple(HIDDEN_QUEUE_STATUSES)}
      )
    )`)
    fields.set('origin', origin)
    fields.set('source', song.source)
    fields.set('status', status)
    fields.set('externalId', song.externalId)
    fields.set('title', song.title)
    fields.set('artistOrChannel', song.artistOrChannel)
    fields.set('durationSeconds', song.durationSeconds)
    fields.set('thumbnailUrl', song.thumbnailUrl)
    fields.set('dateCreated', now)
    fields.set('dateUpdated', now)

    const query = sql`
      INSERT INTO queue ${sql.tuple(Array.from(fields.keys()).map(sql.column))}
      VALUES ${sql.tuple(Array.from(fields.values()))}
    `
    const res = db.run(String(query), query.parameters)

    if (res.changes !== 1) {
      throw new Error('No se pudo agregar la canción a la cola de reproducción')
    }
  }

  /**
   * Get queued items for a given room
   */
  static get (roomId: number): { result: number[], entities: Record<number, QueueItem> } {
    const result: number[] = []
    const entities: Record<number, QueueItem> = {}
    const map = new Map()
    const pathData = new Map()
    let curQueueId = null

    const query = sql`
      SELECT queueId, songId, userId, prevQueueId,
        queue.origin, queue.source, queue.status, queue.externalId,
        queue.title, queue.artistOrChannel, queue.durationSeconds, queue.thumbnailUrl,
        queue.dateCreated, queue.dateUpdated,
        media.mediaId, media.relPath, media.rgTrackGain, media.rgTrackPeak,
        users.name AS userDisplayName, users.dateUpdated AS userDateUpdated,
        paths.pathId, paths.data AS pathData,
        MAX(isPreferred) AS isPreferred
      FROM queue
        INNER JOIN users USING(userId)
        LEFT JOIN media USING(songId)
        LEFT JOIN paths USING(pathId)
      WHERE roomId = ${roomId} AND queue.status != 'REMOVED'
      GROUP BY queueId
      ORDER BY queueId, paths.priority ASC
    `
    const rows = db.all<{
      queueId: number
      songId: number | null
      userId: number
      prevQueueId: number | null
      origin: QueueItemOrigin
      source: SongSource
      status: QueueItemStatus
      externalId: string | null
      title: string
      artistOrChannel: string
      durationSeconds: number | null
      thumbnailUrl: string | null
      dateCreated: number
      dateUpdated: number
      mediaId: number | null
      relPath: string | null
      rgTrackGain: number | null
      rgTrackPeak: number | null
      userDisplayName: string
      userDateUpdated: number
      pathId: number | null
      pathData: string | null
      isPreferred: number | null
    }>(String(query), query.parameters)

    const activeRows = rows.filter(row => row.status !== 'REJECTED')

    for (const row of rows) {
      if (row.pathId !== null && row.pathData !== null && !pathData.has(row.pathId)) {
        pathData.set(row.pathId, JSON.parse(row.pathData))
      }

      const pathPrefs = pathData.get(row.pathId)?.prefs

      const {
        relPath,
        pathId: unusedPathId,
        pathData: unusedPathData,
        isPreferred: unusedIsPreferred,
        ...item
      } = row
      void unusedPathId
      void unusedPathData
      void unusedIsPreferred
      entities[row.queueId] = {
        ...item,
        mediaType: row.source === 'YOUTUBE' ? 'youtube' : this.getType(relPath ?? ''),
        isVideoKeyingEnabled: !!pathPrefs?.isVideoKeyingEnabled,
      }

      if (row.status === 'REJECTED') {
        continue
      } else if (row.prevQueueId === null) {
        // found the first item
        result.push(row.queueId)
        curQueueId = row.queueId
      } else {
        // map indexed by prevQueueId
        map.set(row.prevQueueId, row.queueId)
      }
    }

    while (result.length < activeRows.length) {
      // get the item whose prevQueueId references the current one
      const nextQueueId = map.get(curQueueId)
      if (typeof nextQueueId !== 'number' || !entities[nextQueueId]) break
      result.push(nextQueueId)
      curQueueId = nextQueueId
    }

    // Retain rejected requests for realtime owner feedback without making them
    // part of the playable linked list.
    rows
      .filter(row => row.status === 'REJECTED')
      .forEach(row => result.push(row.queueId))

    return { result, entities }
  }

  /**
   * Move a queue item
   */
  static move ({ prevQueueId, queueId, roomId }: { prevQueueId: number | null, queueId: number, roomId: number }): void {
    if (queueId === prevQueueId) {
      throw new Error('La posición anterior en la cola de reproducción no es válida')
    }

    if (prevQueueId === -1) prevQueueId = null

    const itemQuery = sql`
      SELECT queueId
      FROM queue
      WHERE queueId = ${queueId} AND roomId = ${roomId} AND status = 'APPROVED'
    `
    if (!db.get(String(itemQuery), itemQuery.parameters)) {
      throw new Error('Solo se pueden mover las canciones aprobadas')
    }

    if (prevQueueId !== null) {
      const previousQuery = sql`
        SELECT queueId
        FROM queue
        WHERE queueId = ${prevQueueId}
          AND roomId = ${roomId}
          AND status NOT IN ${sql.tuple(HIDDEN_QUEUE_STATUSES)}
      `
      if (!db.get(String(previousQuery), previousQuery.parameters)) {
        throw new Error('La posición anterior en la cola de reproducción no es válida')
      }
    }

    const query = sql`
      UPDATE queue
      SET prevQueueId = CASE
        WHEN queueId = newChild THEN ${queueId}
        WHEN queueId = curChild AND curParent IS NOT NULL AND newChild IS NOT NULL THEN curParent
        WHEN queueId = ${queueId} THEN ${prevQueueId}
        ELSE queue.prevQueueId
      END
      FROM (SELECT
        (
          SELECT prevQueueId
          FROM queue
          WHERE queueId = ${queueId} AND status NOT IN ${sql.tuple(HIDDEN_QUEUE_STATUSES)}
        ) AS curParent,
        (
          SELECT queueId
          FROM queue
          WHERE prevQueueId = ${queueId} AND status NOT IN ${sql.tuple(HIDDEN_QUEUE_STATUSES)}
        ) AS curChild,
        (
          SELECT queueId
          FROM queue
          WHERE queueId != ${queueId}
            AND prevQueueId ${prevQueueId === null ? sql`IS NULL` : sql`= ${prevQueueId}`}
            AND roomId = ${roomId}
            AND status NOT IN ${sql.tuple(HIDDEN_QUEUE_STATUSES)}
        ) AS newChild
      )
      WHERE roomId = ${roomId} AND status NOT IN ${sql.tuple(HIDDEN_QUEUE_STATUSES)}
    `
    db.run(String(query), query.parameters)
  }

  /**
   * Delete a queue item
   */
  static remove (queueId: number, roomId?: number): void {
    db.exec('BEGIN IMMEDIATE')
    db.exec('PRAGMA defer_foreign_keys = ON') // v0.9 betas didn't have prevQueueId DEFERRABLE

    try {
      const selectQuery = sql`
        SELECT prevQueueId
        FROM queue
        WHERE queueId = ${queueId}
          ${roomId === undefined ? sql`` : sql`AND roomId = ${roomId}`}
          AND status IN ('PENDING_APPROVAL', 'APPROVED')
      `
      const removedRow = db.get<{ prevQueueId: number | null }>(String(selectQuery), selectQuery.parameters)

      if (removedRow === undefined) {
        db.exec('COMMIT')
        return
      }

      // close the gap
      const updateQuery = sql`
        UPDATE queue
        SET prevQueueId = ${removedRow.prevQueueId}
        WHERE prevQueueId = ${queueId} AND status NOT IN ${sql.tuple(HIDDEN_QUEUE_STATUSES)}
      `
      db.run(String(updateQuery), updateQuery.parameters)

      const removeQuery = sql`
        UPDATE queue
        SET status = 'REMOVED',
            prevQueueId = NULL,
            dateUpdated = ${Math.floor(Date.now() / 1000)}
        WHERE queueId = ${queueId}
      `
      db.run(String(removeQuery), removeQuery.parameters)
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }

  /**
   * Check if user owns queue item(s)
   */
  static isOwner (userId: number, queueId: number | number[]): boolean {
    const ids = Array.isArray(queueId) ? queueId : [queueId]
    if (ids.length === 0) return false

    const query = sql`
      SELECT COUNT(*) AS count
      FROM queue
      WHERE userId = ${userId}
        AND queueId IN ${sql.tuple(ids)}
        AND status NOT IN ${sql.tuple(HIDDEN_QUEUE_STATUSES)}
    `
    const res = db.get<{ count: number }>(String(query), query.parameters)
    return res.count === ids.length
  }

  /**
   * Get media type from file extension
   */
  static getType (file: string): 'cdg' | 'mp4' {
    return /\.mp4/i.test(path.extname(file)) ? 'mp4' : 'cdg'
  }

  /**
   * Count participant requests that still consume their configured allowance.
   */
  static countPending (roomId: number, userId: number): number {
    const query = sql`
      SELECT COUNT(*) AS count
      FROM queue
      WHERE roomId = ${roomId}
        AND userId = ${userId}
        AND origin = 'PARTICIPANT'
        AND status IN ('PENDING_APPROVAL', 'APPROVED')
    `
    return db.get<{ count: number }>(String(query), query.parameters)?.count ?? 0
  }

  /**
   * Persist one lifecycle transition. Repeating the current state is a no-op.
   */
  static transition (roomId: number, queueId: number, status: QueueItemStatus): boolean {
    const currentQuery = sql`
      SELECT status
      FROM queue
      WHERE roomId = ${roomId} AND queueId = ${queueId}
    `
    const current = db.get<{ status: QueueItemStatus }>(String(currentQuery), currentQuery.parameters)

    if (!current || current.status === status) return false
    if (!canTransitionQueueItem(current.status, status)) return false

    const updateQuery = sql`
      UPDATE queue
      SET status = ${status}, dateUpdated = ${Math.floor(Date.now() / 1000)}
      WHERE roomId = ${roomId} AND queueId = ${queueId} AND status = ${current.status}
    `
    return db.run(String(updateQuery), updateQuery.parameters).changes === 1
  }

  /**
   * Approve or reject one pending participant request.
   */
  static moderate (roomId: number, queueId: number, status: 'APPROVED' | 'REJECTED'): boolean {
    const currentQuery = sql`
      SELECT status, prevQueueId
      FROM queue
      WHERE roomId = ${roomId} AND queueId = ${queueId}
    `
    const current = db.get<{ status: QueueItemStatus, prevQueueId: number | null }>(
      String(currentQuery),
      currentQuery.parameters,
    )

    if (!current) throw new Error('No se encontró la canción en la cola de reproducción')
    if (current.status === status) return false
    if (current.status !== 'PENDING_APPROVAL') {
      throw new Error('Solo se pueden aprobar o rechazar solicitudes pendientes')
    }

    if (status === 'APPROVED') {
      return Queue.transition(roomId, queueId, status)
    }

    db.exec('BEGIN IMMEDIATE')
    db.exec('PRAGMA defer_foreign_keys = ON')

    try {
      const childQuery = sql`
        UPDATE queue
        SET prevQueueId = ${current.prevQueueId}
        WHERE roomId = ${roomId}
          AND prevQueueId = ${queueId}
          AND status NOT IN ${sql.tuple(HIDDEN_QUEUE_STATUSES)}
      `
      db.run(String(childQuery), childQuery.parameters)

      const rejectQuery = sql`
        UPDATE queue
        SET status = 'REJECTED',
            prevQueueId = NULL,
            dateUpdated = ${Math.floor(Date.now() / 1000)}
        WHERE roomId = ${roomId}
          AND queueId = ${queueId}
          AND status = 'PENDING_APPROVAL'
      `
      const changed = db.run(String(rejectQuery), rejectQuery.parameters).changes === 1
      db.exec('COMMIT')
      return changed
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }

  /**
   * Apply the active player's reported history/current item to persisted state.
   */
  static syncPlayerLifecycle (roomId: number, playerStatus): boolean {
    let changed = false
    const history = new Set<number>()

    if (typeof playerStatus?.historyJSON === 'string') {
      try {
        const parsed = JSON.parse(playerStatus.historyJSON)
        if (Array.isArray(parsed)) {
          parsed.forEach((queueId) => {
            if (Number.isInteger(queueId)) history.add(queueId)
          })
        }
      } catch {
        // Ignore malformed player history. Persisted states remain authoritative.
      }
    }

    history.forEach((queueId) => {
      changed = Queue.transition(roomId, queueId, 'PLAYED') || changed
    })

    const queueId = playerStatus?.queueId
    if (Number.isInteger(queueId) && queueId >= 0 && !history.has(queueId)) {
      const nextStatus = playerStatus?.isErrored ? 'FAILED' : 'PLAYING'
      changed = Queue.transition(roomId, queueId, nextStatus) || changed
    }

    return changed
  }

  /**
   * Put interrupted playback back into the approved queue for safe recovery.
   */
  static requeuePlaying (roomId: number): boolean {
    const query = sql`
      UPDATE queue
      SET status = 'APPROVED', dateUpdated = ${Math.floor(Date.now() / 1000)}
      WHERE roomId = ${roomId} AND status = 'PLAYING'
    `
    return db.run(String(query), query.parameters).changes > 0
  }

  /**
   * Permanently remove retained lifecycle rows before deleting a user.
   */
  static purgeByUser (userId: number): void {
    const query = sql`DELETE FROM queue WHERE userId = ${userId}`
    db.run(String(query), query.parameters)
  }
}

export default Queue
