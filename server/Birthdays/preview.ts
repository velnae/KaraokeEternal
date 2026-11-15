import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { db } from '../lib/Database.js'
import { asset, assetDTO, assertRoom } from './Store.js'
import { birthdayPreviewKey, validateBirthdayPreviewDraft, type BirthdayPreviewState } from '../../shared/birthdayPreview.js'
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
  const rows = db.all<{ cacheKey: string, assetId: string }>('SELECT cacheKey,assetId FROM birthdayPreviewSamples WHERE userId=? AND roomId=? ORDER BY updatedAt,rowid', [userId, roomId])
  for (const row of rows) {
    const media = asset(roomId, row.assetId)
    try {
      if (!media || media.kind !== 'greeting') throw new Error('Missing preview asset')
      const bytes = await fs.readFile(path.join(directory, media.filename))
      if (createHash('sha256').update(bytes).digest('hex') !== media.checksum) throw new Error('Invalid preview checksum')
      samples[row.cacheKey] = assetDTO(media)
    } catch {
      db.run('DELETE FROM birthdayPreviewSamples WHERE userId=? AND roomId=? AND cacheKey=? AND assetId=?', [userId, roomId, row.cacheKey, row.assetId])
    }
  }
  const current = draftRow(userId, roomId)
  return { revision: current?.revision ?? 0, draft: current ? JSON.parse(current.draftJSON) : null, samples }
}

export function recordPreviewSample (userId: number, roomId: number, config: BirthdaySettings, sample: { name: string, script: string }, media: BirthdayAsset, revision?: number) {
  const cacheKey = birthdayPreviewKey(config, { name: sample.name, script: media.script! }, config.defaultVoiceId, config.speechStyle)
  db.run(`INSERT INTO birthdayPreviewSamples(userId,roomId,cacheKey,assetId,updatedAt) VALUES(?,?,?,?,?)
    ON CONFLICT(userId,roomId,cacheKey) DO UPDATE SET assetId=excluded.assetId,updatedAt=excluded.updatedAt`, [userId, roomId, cacheKey, media.id, Date.now()])
  db.run(`DELETE FROM birthdayPreviewSamples WHERE userId=? AND roomId=? AND rowid NOT IN
    (SELECT rowid FROM birthdayPreviewSamples WHERE userId=? AND roomId=? ORDER BY updatedAt DESC,rowid DESC LIMIT 20)`, [userId, roomId, userId, roomId])
  const current = draftRow(userId, roomId)
  if (!current || current.revision !== revision) return media
  const draft = validateBirthdayPreviewDraft(JSON.parse(current.draftJSON))
  if (draft.name !== sample.name || draft.script !== sample.script) return media
  const saved = savePreviewDraft(userId, roomId, { ...draft, script: media.script }, current.revision)
  return { ...media, previewRevision: saved.revision }
}
