import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { db } from '../lib/Database.js'
import { asset, assetDTO, assertRoom } from './Store.js'
import { birthdayPreviewKey, validateBirthdayPreviewDraft, type BirthdayPreviewDraft, type BirthdayPreviewState } from '../../shared/birthdayPreview.js'
import type { BirthdayAsset, BirthdaySettings } from '../../shared/birthdays.js'

interface DraftRow { revision: number, draftJSON: string }
const draftRow = (userId: number, roomId: number) => db.get<DraftRow>('SELECT revision,draftJSON FROM birthdayPreviewDrafts WHERE userId=? AND roomId=?', [userId, roomId])
const conflict = () => Object.assign(new Error('La previsualización cambió en otra ventana. Recargue para recuperar el último borrador.'), { status: 409 })

export function savePreviewDraft (userId: number, roomId: number, value: unknown, revision: number) {
  assertRoom(roomId)
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('Revisión de previsualización inválida.')
  const draft = validateBirthdayPreviewDraft(value)
  const current = draftRow(userId, roomId)
  if ((current?.revision ?? 0) !== revision) throw conflict()
  db.run(`INSERT INTO birthdayPreviewDrafts(userId,roomId,revision,draftJSON) VALUES(?,?,?,?)
    ON CONFLICT(userId,roomId) DO UPDATE SET revision=excluded.revision,draftJSON=excluded.draftJSON`, [userId, roomId, revision + 1, JSON.stringify(draft)])
  return { revision: revision + 1 }
}

export async function readPreview (directory: string, userId: number, roomId: number): Promise<BirthdayPreviewState> {
  const samples: Record<string, BirthdayAsset> = {}
  const savedDrafts: Record<string, BirthdayPreviewDraft> = {}
  const unavailable: Record<string, string> = {}
  const current = draftRow(userId, roomId)
  const rows = db.all<{ cacheKey: string, assetId: string, draftJSON: string | null }>('SELECT cacheKey,assetId,draftJSON FROM birthdayPreviewSamples WHERE userId=? AND roomId=? ORDER BY updatedAt,rowid', [userId, roomId])
  for (const row of rows) {
    // Legacy samples retain their known text/voice identity; only visual choices
    // fall back to the existing draft when no original snapshot was recorded.
    if (row.draftJSON) savedDrafts[row.cacheKey] = validateBirthdayPreviewDraft(JSON.parse(row.draftJSON))
    else if (current) {
      const [name, script] = JSON.parse(row.cacheKey)
      savedDrafts[row.cacheKey] = validateBirthdayPreviewDraft({ ...JSON.parse(current.draftJSON), name, script })
    }
    const media = asset(roomId, row.assetId)
    try {
      if (!media || media.kind !== 'greeting') throw new Error('Missing preview asset')
      const bytes = await fs.readFile(path.join(directory, media.filename))
      if (createHash('sha256').update(bytes).digest('hex') !== media.checksum) throw new Error('Invalid preview checksum')
      samples[row.cacheKey] = assetDTO(media)
    } catch {
      unavailable[row.cacheKey] = 'No se pudo abrir el audio guardado. Vuelva a abrir la prueba para reintentar.'
    }
  }
  return { revision: current?.revision ?? 0, draft: current ? JSON.parse(current.draftJSON) : null, samples, savedDrafts, unavailable }
}

export function recordPreviewSample (userId: number, roomId: number, config: BirthdaySettings, sample: { name: string, script: string }, media: BirthdayAsset, revision?: number, originalDraft?: BirthdayPreviewDraft) {
  const cacheKey = birthdayPreviewKey(config, { name: sample.name, script: media.script! }, config.defaultVoiceId, config.speechStyle)
  const current = draftRow(userId, roomId)
  const source = originalDraft ?? (current && JSON.parse(current.draftJSON))
  const snapshot = source && validateBirthdayPreviewDraft({ ...source, name: sample.name, script: media.script })
  db.run(`INSERT INTO birthdayPreviewSamples(userId,roomId,cacheKey,assetId,updatedAt,draftJSON) VALUES(?,?,?,?,?,?)
    ON CONFLICT(userId,roomId,cacheKey) DO UPDATE SET assetId=excluded.assetId,updatedAt=excluded.updatedAt,draftJSON=excluded.draftJSON`, [userId, roomId, cacheKey, media.id, Date.now(), snapshot ? JSON.stringify(snapshot) : null])
  if (!current || current.revision !== revision) return media
  const draft = validateBirthdayPreviewDraft(JSON.parse(current.draftJSON))
  if (draft.name !== sample.name || draft.script !== sample.script) return media
  const saved = savePreviewDraft(userId, roomId, { ...draft, script: media.script }, current.revision)
  return { ...media, previewRevision: saved.revision }
}
