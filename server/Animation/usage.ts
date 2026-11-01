import { db } from '../lib/Database.js'
import { animationPrefs, type AnimationClip } from '../../shared/animation.js'
import type { AudioUsage } from '../../shared/audioCatalog.js'
import { businessDate, currentSession } from './sessions.js'

function cutoff (roomId: number) {
  const room = db.get<{ data: string }>('SELECT data FROM rooms WHERE roomId=?', [roomId])
  return animationPrefs(room ? JSON.parse(room.data).prefs?.animation : undefined).cutoffHour
}
export function recordAudioUsage (roomId: number, sourceId: string, clipId: string, sourceType: 'intervention' | 'ambience', startedAt: number, sessionId?: string | null) {
  const session = sessionId ? db.get<{ businessDate: string }>('SELECT businessDate FROM animationSessions WHERE roomId=? AND sessionId=?', [roomId, sessionId]) : null
  db.run('INSERT OR IGNORE INTO audioUsage(roomId,sourceId,clipId,sourceType,sessionId,businessDate,startedAt) VALUES(?,?,?,?,?,?,?)',
    [roomId, sourceId, clipId, sourceType, sessionId ?? null, session?.businessDate ?? businessDate(startedAt, cutoff(roomId)), startedAt])
}
export function backfillAudioUsage () {
  // Old history proves only the first asset started, never a later effect or ambience.
  db.exec('SAVEPOINT audio_usage_backfill')
  try {
    for (const row of db.all<{ roomId: number, interventionId: string, clipId: string, startedAt: number, sessionId: string | null }>(`SELECT i.roomId,i.interventionId,coalesce(json_extract(i.sequenceJSON,'$[0].id'),i.clipId) clipId,i.startedAt,i.sessionId FROM animationInterventions i
      JOIN rooms r ON r.roomId=i.roomId WHERE i.startedAt IS NOT NULL AND NOT EXISTS(SELECT 1 FROM audioUsage u WHERE u.roomId=i.roomId AND u.sourceId='intervention:'||i.interventionId AND u.clipId=coalesce(json_extract(i.sequenceJSON,'$[0].id'),i.clipId))`)) {
      recordAudioUsage(row.roomId, `intervention:${row.interventionId}`, row.clipId, 'intervention', row.startedAt, row.sessionId)
    }
    db.exec('RELEASE audio_usage_backfill')
  } catch (error) {
    db.exec('ROLLBACK TO audio_usage_backfill')
    db.exec('RELEASE audio_usage_backfill')
    throw error
  }
}
export function audioUsage (roomId: number, ids: string[]): Record<string, AudioUsage> {
  const day = currentSession(roomId)?.businessDate ?? businessDate(Date.now(), cutoff(roomId))
  const result: Record<string, AudioUsage> = Object.fromEntries(ids.map(id => [id, { total: 0, currentDay: 0, lastStartedAt: null, businessDate: day }]))
  if (!ids.length) return result
  for (const row of db.all<{ clipId: string, total: number, currentDay: number, lastStartedAt: number }>(`SELECT clipId,count(*) total,sum(CASE WHEN businessDate=? THEN 1 ELSE 0 END) currentDay,max(startedAt) lastStartedAt
    FROM audioUsage WHERE roomId=? AND clipId IN (${ids.map(() => '?').join(',')}) GROUP BY clipId`, [day, roomId, ...ids])) result[row.clipId] = { total: row.total, currentDay: row.currentDay, lastStartedAt: row.lastStartedAt, businessDate: day }
  return result
}
export function leastUsedAudio (roomId: number, clips: AnimationClip[]) {
  const usage = audioUsage(roomId, clips.map(clip => clip.id))
  return [...clips].sort((a, b) => usage[a.id].currentDay - usage[b.id].currentDay || usage[a.id].total - usage[b.id].total || (usage[a.id].lastStartedAt ?? 0) - (usage[b.id].lastStartedAt ?? 0) || a.id.localeCompare(b.id))[0]
}
