import { db } from '../../lib/Database.js'
import Tables from '../../Tables/Tables.js'
import type CallJobs from './Jobs.js'
import { backgroundOverview } from './Backgrounds.js'
import { callControls, job, jobDTO, part, sameSpeaker } from './Store.js'
import { compositionRevision } from './Composition.js'
import { karaokePreviewKey, validateKaraokePreviewDraft, type KaraokePreviewDraft, type KaraokePreviewState } from '../../../shared/karaokePreview.js'
import type { CallJob } from '../../../shared/karaokeCalls.js'

interface DraftRow { revision: number, draftJSON: string }
const draftRow = (userId: number, roomId: number) => db.get<DraftRow>('SELECT revision,draftJSON FROM karaokePreviewDrafts WHERE userId=? AND roomId=?', [userId, roomId])
const conflict = () => Object.assign(new Error('La prueba cambió en otra ventana. Recargue para recuperar el último borrador.'), { status: 409 })

function initialDraft (worker: CallJobs, roomId: number): KaraokePreviewDraft {
  const snapshot = worker.snapshot(roomId)
  const backgrounds = backgroundOverview(roomId)
  const controls = callControls(roomId)
  const intros = [...snapshot.intros].sort((a, b) => Number(controls.introIds.includes(b.variantId)) - Number(controls.introIds.includes(a.variantId)))
  const prepared = snapshot.tables.filter(table => table.part && !table.outdated)
  const intro = intros.find(intro => prepared.some(table => sameSpeaker(part(roomId, intro.id)!, part(roomId, table.part!.id)!))) ?? intros[0]
  const table = prepared.find(table => intro && sameSpeaker(part(roomId, intro.id)!, part(roomId, table.part!.id)!)) ?? prepared[0] ?? snapshot.tables[0]
  const background = (kind: 'video' | 'bed') => {
    const assets = backgrounds.assets.filter(asset => asset.kind === kind && asset.state === 'ready')
    const configured = backgrounds.settings[`${kind}Mode`] === 'single' && assets.find(asset => asset.id === backgrounds.settings[`${kind}Id`])
    return (configured || assets.find(asset => asset.active) || assets[0])?.id ?? ''
  }
  return { introId: intro?.id ?? '', tableId: table ? String(table.tableId) : '', performer: 'Ana', song: 'Rayando el sol', mode: 'hybrid',
    videoId: background('video'), bedId: background('bed'), volume: backgrounds.settings.bedVolume }
}
function validateSelections (worker: CallJobs, roomId: number, draft: KaraokePreviewDraft) {
  const snapshot = worker.snapshot(roomId)
  if (draft.introId && !snapshot.intros.some(value => value.id === draft.introId)) throw new Error('Seleccione una introducción disponible de esta sala.')
  if (draft.tableId && !snapshot.tables.some(value => String(value.tableId) === draft.tableId)) throw new Error('Seleccione una mesa activa de esta sala.')
  const backgrounds = backgroundOverview(roomId)
  for (const kind of ['video', 'bed'] as const) {
    if (draft[`${kind}Id`] && !backgrounds.assets.some(asset => asset.id === draft[`${kind}Id`] && asset.kind === kind && asset.state === 'ready')) throw new Error('Seleccione un fondo disponible de esta sala.')
  }
}
export function saveKaraokePreview (worker: CallJobs, userId: number, roomId: number, value: unknown, revision: unknown) {
  Tables.room(roomId)
  if (!Number.isSafeInteger(revision) || Number(revision) < 0) throw new Error('Revisión de prueba inválida.')
  const current = draftRow(userId, roomId)
  if ((current?.revision ?? 0) !== revision) throw conflict()
  const draft = validateKaraokePreviewDraft(value)
  validateSelections(worker, roomId, draft)
  db.run(`INSERT INTO karaokePreviewDrafts(userId,roomId,revision,draftJSON) VALUES(?,?,?,?)
    ON CONFLICT(userId,roomId) DO UPDATE SET revision=excluded.revision,draftJSON=excluded.draftJSON`, [userId, roomId, Number(revision) + 1, JSON.stringify(draft)])
  return { revision: Number(revision) + 1 }
}
export async function readKaraokePreview (worker: CallJobs, userId: number, roomId: number): Promise<KaraokePreviewState> {
  Tables.room(roomId)
  const current = draftRow(userId, roomId)
  const samples: Record<string, CallJob> = {}
  for (const saved of db.all<{ cacheKey: string, jobId: string }>('SELECT cacheKey,jobId FROM karaokePreviewSamples WHERE userId=? AND roomId=? ORDER BY updatedAt,rowid', [userId, roomId])) {
    const row = job(roomId, saved.jobId)
    if (!row || row.purpose !== 'preview' || !['hybrid', 'reference'].includes(row.operation)) continue
    const value = jobDTO(row, JSON.parse(row.profileJSON))
    if (value.result) {
      try {
        await worker.bytes(roomId, value.result.id)
      } catch {
        value.result = null
        value.error = 'El audio guardado no está disponible. Revise los recursos y prepare otra prueba.'
      }
    }
    samples[saved.cacheKey] = value
  }
  return { revision: current?.revision ?? 0, persisted: !!current, recipeRevision: compositionRevision,
    draft: current ? validateKaraokePreviewDraft(JSON.parse(current.draftJSON)) : initialDraft(worker, roomId), samples }
}
export async function prepareKaraokePreview (worker: CallJobs, userId: number, roomId: number, input: { revision?: unknown, requestId?: unknown, retry?: unknown }) {
  const current = draftRow(userId, roomId)
  if (!current || current.revision !== input.revision) throw conflict()
  if (input.retry !== undefined && typeof input.retry !== 'boolean') throw new Error('Reintento de prueba inválido.')
  const draft = validateKaraokePreviewDraft(JSON.parse(current.draftJSON))
  validateSelections(worker, roomId, draft)
  const key = karaokePreviewKey(draft, worker.snapshot(roomId), compositionRevision)
  const saved = db.get<{ jobId: string }>('SELECT jobId FROM karaokePreviewSamples WHERE userId=? AND roomId=? AND cacheKey=?', [userId, roomId, key])
  const cached = saved && job(roomId, saved.jobId)
  if (cached) {
    const value = jobDTO(cached, JSON.parse(cached.profileJSON))
    if (['queued', 'generating', 'preparing'].includes(value.status) || (value.status === 'uncertain' && !input.retry)) return { key, job: value }
    if (value.status === 'ready' && value.result && !value.outdated) {
      try {
        await worker.bytes(roomId, value.result.id)
        return { key, job: value }
      } catch { /* Explicit preparation below reports unavailable dependencies. */ }
    }
  }
  if (draftRow(userId, roomId)?.revision !== input.revision) throw conflict()
  const submitted = worker.submit(roomId, draft.mode, { requestId: input.requestId, introId: draft.introId, tableId: Number(draft.tableId), performer: draft.performer, song: draft.song })
  db.run(`INSERT INTO karaokePreviewSamples(userId,roomId,cacheKey,jobId,updatedAt) VALUES(?,?,?,?,?)
    ON CONFLICT(userId,roomId,cacheKey) DO UPDATE SET jobId=excluded.jobId,updatedAt=excluded.updatedAt`, [userId, roomId, key, submitted.id, Date.now()])
  db.run(`DELETE FROM karaokePreviewSamples WHERE userId=? AND roomId=? AND rowid NOT IN
    (SELECT rowid FROM karaokePreviewSamples WHERE userId=? AND roomId=? ORDER BY updatedAt DESC,rowid DESC LIMIT 10)`, [userId, roomId, userId, roomId])
  return { key, job: submitted }
}
