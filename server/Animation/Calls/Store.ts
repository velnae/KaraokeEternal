import { createHash } from 'node:crypto'
import { db } from '../../lib/Database.js'
import Tables from '../../Tables/Tables.js'
import type { GreetingVoiceProfile } from '../../Greetings/voiceProfile.js'
import { defaultTableCallText, listeningHistoryLimit, type CallControls, type CallJob, type CallJobPurpose, type CallOperation, type CallPart, type CallStatus, type TableCallVoice } from '../../../shared/karaokeCalls.js'

export const key = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export interface PartRow extends CallPart {
  roomId: number | null
  cacheKey: string
  master: string
  filename: string
  checksum: string
  masterChecksum: string
  dependenciesJSON: string
  retired: number
  nameId?: string | null
  nameSelected?: number
  nameMetadataJSON?: string | null
  profileJSON?: string | null
}
export interface JobInput {
  title: string
  text: string
  variantId: string
  regenerate: boolean
  tableId?: number
  code?: string
  revision?: number
  tablePartId?: string
  introId?: string
  continuation?: string
  sourceKind?: 'name' | 'template' | 'signature' | 'continuation'
  manualBank?: boolean
  bankTemplateId?: string
  bankTemplateRevision?: number
  sourceIds?: string[]
  historical?: boolean
  nameId?: string
  nameBankRevision?: number
  nameStyle?: string | null
  nameModel?: import('../../../shared/nameVoices.js').NameVoiceModel
  nameRecipeRevision?: number | null
  nameReprocessId?: string
}
export interface JobRow {
  purpose: CallJobPurpose
  priority: number
  id: string
  roomId: number
  requestId: string
  operation: CallOperation
  requestJSON: string
  inputJSON: string
  profileJSON: string
  text: string
  status: CallStatus
  error: string | null
  resultId: string | null
  providerMs: number
  preparationMs: number
  retryAt: number
  createdAt: number
  updatedAt: number
}
export interface Binding { tableId: number, roomId: number, spokenText: string, codeSnapshot: string, revision: number, partId: string | null }
export interface RequestRow {
  playbackReason: string | null
  recoveryJobId: string | null
  recoveredPartId: string | null
  queueId: number
  roomId: number
  inputKey: string
  introId: string | null
  jobId: string | null
  resultId: string | null
  status: 'waiting' | 'preparing' | 'ready' | 'fallback' | 'cancelled'
  reason: string | null
  attempt: number
  startedAt: number | null
  updatedAt: number
}
export const callControls = (roomId: number): CallControls => {
  const row = db.get<{ revision: number, preparing: number, enabled: number, listeningEnabled: number, introIdsJSON: string }>('SELECT * FROM karaokeCallControls WHERE roomId=?', [roomId])
  return row ? { revision: row.revision, preparing: !!row.preparing, enabled: !!row.enabled, listeningEnabled: !!row.listeningEnabled, introIds: JSON.parse(row.introIdsJSON) } : { revision: 0, preparing: false, enabled: false, listeningEnabled: false, introIds: [] }
}
export const requestCall = (roomId: number, queueId: number) => db.get<RequestRow>('SELECT * FROM karaokeCallRequests WHERE roomId=? AND queueId=?', [roomId, queueId])
export const callSessionAllows = (roomId: number) => {
  const session = db.get<{ status: string }>('SELECT status FROM animationSessions WHERE roomId=? ORDER BY openedAt DESC,rowid DESC LIMIT 1', [roomId])
  return !session || session.status === 'OPEN'
}
export const part = (roomId: number, id: string) => db.get<PartRow>(`SELECT * FROM karaokeCallParts WHERE id=? AND retired=0
  AND (roomId=? OR (roomId IS NULL AND kind='name'))`, [id, roomId])
export const job = (roomId: number, id: string) => db.get<JobRow>('SELECT * FROM karaokeCallJobs WHERE roomId=? AND id=?', [roomId, id])
export const retainedListening = (roomId: number) => db.all<{ queueId: number, resultId: string | null, signatureId: string | null }>(`SELECT p.queueId,p.resultId,p.signatureId
  FROM listeningPresentations p JOIN queue q USING(queueId) WHERE p.roomId=? AND q.roomId=p.roomId AND
  (q.status IN ('APPROVED','PLAYING') OR q.queueId IN (SELECT q.queueId FROM queue q JOIN listeningPresentations p USING(queueId)
    WHERE q.roomId=? AND q.historyClearedAt IS NULL AND q.status NOT IN ('APPROVED','PLAYING','REMOVED','REJECTED')
    ORDER BY q.queueId DESC LIMIT ?))`, [roomId, roomId, listeningHistoryLimit])
export const retainedSinging = (roomId: number) => db.all<{ queueId: number, resultId: string | null, recoveredPartId: string | null }>(`SELECT r.queueId,r.resultId,r.recoveredPartId
  FROM karaokeCallRequests r JOIN queue q USING(queueId) WHERE r.roomId=? AND q.roomId=r.roomId AND
  (q.status IN ('APPROVED','PLAYING') OR q.queueId IN (SELECT q.queueId FROM queue q JOIN karaokeCallRequests r USING(queueId)
    WHERE q.roomId=? AND q.historyClearedAt IS NULL AND q.status NOT IN ('APPROVED','PLAYING','REMOVED','REJECTED')
    ORDER BY q.queueId DESC LIMIT ?))`, [roomId, roomId, listeningHistoryLimit])
export const binding = (roomId: number, tableId: number) => db.get<Binding>('SELECT * FROM tableCallVoices WHERE roomId=? AND tableId=?', [roomId, tableId])
export const partDTO = (row: PartRow): CallPart => ({ id: row.id, kind: row.kind, title: row.title, text: row.text, durationMs: row.durationMs, profileKey: row.profileKey, createdAt: row.createdAt, variantId: row.variantId })
export const intros = (roomId: number) => db.all<PartRow>(`SELECT * FROM karaokeCallParts p WHERE roomId=? AND kind='intro' AND retired=0
  AND NOT EXISTS(SELECT 1 FROM karaokeCallParts newer WHERE newer.roomId=p.roomId AND newer.variantId=p.variantId AND newer.kind='intro' AND newer.retired=0 AND newer.rowid>p.rowid) ORDER BY createdAt`, [roomId])
export function tableVoice (roomId: number, tableId: number, profile: GreetingVoiceProfile): TableCallVoice {
  const table = Tables.get(roomId, tableId)
  const saved = binding(roomId, tableId)
  const audio = saved?.partId ? part(roomId, saved.partId) : undefined
  return { tableId, code: table.code, spokenText: saved?.codeSnapshot === table.code ? saved.spokenText : defaultTableCallText(table.code),
    revision: saved?.revision ?? 0, part: audio ? partDTO(audio) : null,
    outdated: !!saved && (!audio || saved.codeSnapshot !== table.code || saved.spokenText !== audio.text),
    recordedProfile: audio ? partProfile(audio, profile) : null }
}
export function jobOutdated (row: JobRow, profile: GreetingVoiceProfile) {
  const input: JobInput = JSON.parse(row.inputJSON)
  const captured = row.profileJSON ? JSON.parse(row.profileJSON) : profile
  if (!captured?.model || !captured.voice) return true
  if (row.operation === 'compose' && row.purpose === 'preview' && input.historical) return false
  if (input.tableId !== undefined) {
    try {
      const table = Tables.get(row.roomId, input.tableId)
      const current = binding(row.roomId, input.tableId)
      if (table.status !== 'active' || table.code !== input.code || current?.revision !== input.revision) return true
      if (input.tablePartId && current?.partId !== input.tablePartId) return true
    } catch { return true }
  }
  if (input.introId && !intros(row.roomId).some(item => item.id === input.introId)) return true
  return false
}

export function partProfile (row: PartRow, fallback?: GreetingVoiceProfile): GreetingVoiceProfile | null {
  const stored = row.profileJSON ? JSON.parse(row.profileJSON) : row.nameMetadataJSON ? JSON.parse(row.nameMetadataJSON).profile : null
  return stored && key(stored) === row.profileKey ? stored : fallback && key(fallback) === row.profileKey ? fallback : null
}

export function sameSpeaker (left: PartRow, right: PartRow) {
  if (left.profileKey === right.profileKey) return true
  const a = partProfile(left)
  const b = partProfile(right)
  return !!a && !!b && a.provider === b.provider && a.voice === b.voice && a.processingRevision === b.processingRevision
}

export function fixedPart (roomId: number, kind: 'signature' | 'continuation', text: string, reference?: PartRow) {
  return db.all<PartRow>('SELECT * FROM karaokeCallParts WHERE roomId=? AND kind=? AND text=? AND retired=0 ORDER BY createdAt DESC,rowid DESC', [roomId, kind, text])
    .find(row => !reference || sameSpeaker(row, reference))
}

export function backfillPartProfiles (profile: GreetingVoiceProfile) {
  const profiles = new Map<string, GreetingVoiceProfile>([[key(profile), profile]])
  for (const row of db.all<{ profileJSON: string }>('SELECT DISTINCT profileJSON FROM karaokeCallJobs')) {
    const value = JSON.parse(row.profileJSON)
    profiles.set(key(value), value)
  }
  const parts = db.all<PartRow>('SELECT * FROM karaokeCallParts WHERE profileJSON IS NULL')
  for (const row of parts) {
    const value = partProfile(row)
    if (value) profiles.set(key(value), value)
  }
  for (const row of parts) {
    const value = partProfile(row) ?? profiles.get(row.profileKey)
    if (value) db.run('UPDATE karaokeCallParts SET profileJSON=? WHERE id=?', [JSON.stringify(value), row.id])
  }
}
export function jobDTO (row: JobRow, profile: GreetingVoiceProfile): CallJob {
  const result = row.resultId ? part(row.roomId, row.resultId) : undefined
  return { id: row.id, tableId: (JSON.parse(row.inputJSON) as JobInput).tableId, operation: row.operation, text: row.text, status: row.status, error: row.error,
    createdAt: row.createdAt, providerMs: row.providerMs, preparationMs: row.preparationMs,
    result: result ? partDTO(result) : null, outdated: jobOutdated(row, profile) }
}
