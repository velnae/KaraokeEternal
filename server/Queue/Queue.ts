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

const HIDDEN_QUEUE_STATUSES = ['REJECTED', 'REMOVED']

class Queue {
  /**
   * Add a songId to a room's queue
   */
  static add ({ roomId, songId, userId }: { roomId: number, songId: number, userId: number }): void {
    const fields = new Map()
    const now = Math.floor(Date.now() / 1000)
    fields.set('roomId', roomId)
    fields.set('songId', songId)
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
    fields.set('origin', 'PARTICIPANT')
    fields.set('source', 'LOCAL')
    fields.set('status', 'APPROVED')
    fields.set('title', sql`(SELECT title FROM songs WHERE songId = ${songId})`)
    fields.set('artistOrChannel', sql`(
      SELECT artists.name
      FROM songs
        INNER JOIN artists USING(artistId)
      WHERE songs.songId = ${songId}
    )`)
    fields.set('durationSeconds', sql`(
      SELECT media.duration
      FROM media
        INNER JOIN paths USING(pathId)
      WHERE media.songId = ${songId}
      ORDER BY media.isPreferred DESC, paths.priority ASC, media.mediaId ASC
      LIMIT 1
    )`)
    fields.set('dateCreated', now)
    fields.set('dateUpdated', now)

    const query = sql`
      INSERT INTO queue ${sql.tuple(Array.from(fields.keys()).map(sql.column))}
      VALUES ${sql.tuple(Array.from(fields.values()))}
    `
    const res = db.run(String(query), query.parameters)

    if (res.changes !== 1) {
      throw new Error('Could not add song to queue')
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
      WHERE roomId = ${roomId} AND queue.status NOT IN ${sql.tuple(HIDDEN_QUEUE_STATUSES)}
      GROUP BY queueId
      ORDER BY queueId, paths.priority ASC
    `
    const rows = db.all<{
      queueId: number
      songId: number
      userId: number
      prevQueueId: number
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

      if (row.prevQueueId === null) {
        // found the first item
        result.push(row.queueId)
        curQueueId = row.queueId
      } else {
        // map indexed by prevQueueId
        map.set(row.prevQueueId, row.queueId)
      }
    }

    while (result.length < rows.length) {
      // get the item whose prevQueueId references the current one
      const nextQueueId = map.get(curQueueId)
      if (typeof nextQueueId !== 'number' || !entities[nextQueueId]) break
      result.push(nextQueueId)
      curQueueId = nextQueueId
    }

    return { result, entities }
  }

  /**
   * Move a queue item
   */
  static move ({ prevQueueId, queueId, roomId }: { prevQueueId: number | null, queueId: number, roomId: number }): void {
    if (queueId === prevQueueId) {
      throw new Error('Invalid prevQueueId')
    }

    if (prevQueueId === -1) prevQueueId = null

    const itemQuery = sql`
      SELECT queueId
      FROM queue
      WHERE queueId = ${queueId} AND roomId = ${roomId} AND status = 'APPROVED'
    `
    if (!db.get(String(itemQuery), itemQuery.parameters)) {
      throw new Error('Only approved queue items can be moved')
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
        throw new Error('Invalid prevQueueId')
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
