import { db } from '../lib/Database.js'
import { clipDurationLimit, normalizeEffectType, VOICE_FAMILIES, type AudioKind, type AnimationClip } from '../../shared/animation.js'
import type { AudioMetadata, AudioResource, PreparationState, ResourcePage, ResourceState } from '../../shared/audioCatalog.js'
import { withoutAudioTags } from '../../shared/audioTags.js'
import { audioUsage } from './usage.js'
import { effectCategoryValue } from '../../shared/effectCategories.js'

export interface StoredResource extends Omit<AudioResource, 'metadata'> { metadataJSON: string, filename: string | null, deletedAt: number | null }
export const resourceDTO = ({ filename, metadataJSON, deletedAt, ...row }: StoredResource, usageRoom?: number): AudioResource => {
  void filename
  void deletedAt
  return { ...row, metadata: JSON.parse(metadataJSON), ...(usageRoom !== undefined ? { usage: audioUsage(usageRoom, [row.id])[row.id] } : {}) }
}
export function getResource (id: string, roomId?: number): StoredResource | undefined {
  const row = db.get<StoredResource>('SELECT * FROM audioResources WHERE id=? AND deletedAt IS NULL', [id])
  if (roomId !== undefined && db.get('SELECT resourceId FROM audioRoomDeletions WHERE roomId=? AND resourceId=?', [roomId, id])) return undefined
  return row && (roomId === undefined || row.roomId === null || row.roomId === roomId) ? row : undefined
}
export const isResourceDeleted = (id: string) => !!db.get('SELECT id FROM audioResources WHERE id=? AND deletedAt IS NOT NULL', [id])
export const resourceRoomFilter = '(roomId=? OR roomId IS NULL) AND NOT EXISTS (SELECT 1 FROM audioRoomDeletions WHERE resourceId=audioResources.id AND roomId=?)'
export function assertResourceUnused (roomId: number, id: string) {
  const now = Date.now()
  const intervention = db.get(`SELECT interventionId FROM animationInterventions WHERE roomId=?
    AND (status IN ('PENDING','RESERVED','PLAYING') OR leaseUntil>?)
    AND (clipId=? OR EXISTS(SELECT 1 FROM json_each(sequenceJSON) WHERE json_extract(value,'$.id')=?))`, [roomId, now, id, id])
  const ambience = db.get(`SELECT roomId FROM animationRoomState WHERE roomId=?
    AND json_extract(ambienceJSON,'$.clip.id')=? AND json_extract(ambienceJSON,'$.until')>?`, [roomId, id, now])
  if (intervention || ambience) throw new Error('El audio está en uso o tiene un anuncio pendiente. Deténgalo o cancele el anuncio y vuelva a intentar.')
}
export function validateMetadata (kind: AudioKind, value: Partial<AudioMetadata>): AudioMetadata {
  if (!['voice', 'effect', 'ambience'].includes(kind)) throw new Error('Tipo de audio no válido.')
  const effectType = normalizeEffectType(kind, value.effectType)
  const family = effectType === 'transition' ? 'manual' : value.family ?? 'manual'
  if (value.celebrationMode !== undefined && !['confirmed', 'song_end'].includes(value.celebrationMode)) throw new Error('Uso de celebración no válido.')
  if (family !== 'manual' && !VOICE_FAMILIES.includes(family)) throw new Error('Uso del audio no válido.')
  const modes = value.modes ?? ['dinner', 'mixed', 'party']
  if (!Array.isArray(modes) || !modes.length || modes.some(mode => !['dinner', 'mixed', 'party'].includes(mode))) throw new Error('Seleccione al menos un perfil válido.')
  for (const key of ['text', 'category', 'language', 'style', 'voiceName'] as const) {
    if (value[key] !== undefined && (typeof value[key] !== 'string' || value[key]!.length > (key === 'text' ? 2000 : 120))) throw new Error('Revise los datos del audio.')
  }
  if (value.loop !== undefined && (kind !== 'ambience' || typeof value.loop !== 'boolean')) throw new Error('El bucle solo corresponde a ambientes.')
  if (family === 'promotion' && (!Number.isFinite(value.validUntil) || value.validUntil! <= Date.now())) throw new Error('Indique una vigencia futura para la promoción.')
  return { ...value, celebrationMode: kind === 'voice' && family === 'celebration' ? value.celebrationMode : undefined, effectType, category: kind === 'effect' ? effectCategoryValue(value.category) : value.category, origin: value.origin ?? 'uploaded', text: value.text?.trim() ?? '', family, modes: [...new Set(modes)] }
}
export function createResource (input: { id: string, roomId: number | null, kind: AudioKind, title: string, metadata: AudioMetadata, state?: ResourceState, preparation?: PreparationState, createdAt?: number }) {
  if (isResourceDeleted(input.id)) throw new Error('Este audio fue eliminado. Use una nueva solicitud para subir otro archivo.')
  if (!/^[a-zA-Z0-9-]{1,100}$/.test(input.id) || typeof input.title !== 'string' || !input.title.trim() || input.title.length > 120) throw new Error('Indique un nombre de hasta 120 caracteres.')
  const existing = getResource(input.id)
  if (existing) {
    if (existing.roomId !== input.roomId) throw new Error('El audio pertenece a otra sala.')
    return existing
  }
  const now = Date.now()
  const metadata = input.kind === 'effect' ? { ...input.metadata, category: effectCategoryValue(input.metadata.category) } : input.metadata
  db.run(`INSERT INTO audioResources(id,roomId,kind,title,state,preparation,metadataJSON,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?)`,
    [input.id, input.roomId, input.kind, input.title.trim(), input.state ?? 'active', input.preparation ?? 'preparing', JSON.stringify(metadata), input.createdAt ?? now, now])
  return getResource(input.id)!
}
export function prepareResource (id: string, preparation: PreparationState, error: string | null = null) {
  db.run('UPDATE audioResources SET preparation=?,error=?,updatedAt=? WHERE id=?', [preparation, error, Date.now(), id])
}
export function completeResource (id: string, media: { filename: string, mime: string, checksum: string, durationMs: number, size: number }) {
  db.run(`UPDATE audioResources SET preparation='ready',filename=?,mime=?,checksum=?,durationMs=?,size=?,error=NULL,updatedAt=? WHERE id=?`,
    [media.filename, media.mime, media.checksum, media.durationMs, media.size, Date.now(), id])
}
export function editResource (roomId: number, id: string, patch: { title?: string, state?: ResourceState, metadata?: Partial<AudioMetadata> }) {
  if (!Object.keys(patch).every(key => ['title', 'state', 'metadata'].includes(key))) throw new Error('Los datos de uso son de solo lectura.')
  const row = getResource(id, roomId)
  if (!row || row.roomId !== roomId) throw new Error('Este audio es compartido o pertenece a otra sala; no se puede modificar.')
  const title = patch.title ?? row.title
  if (typeof title !== 'string' || !title.trim() || title.length > 120) throw new Error('Indique un nombre de hasta 120 caracteres.')
  if (patch.state !== undefined && !['active', 'disabled', 'archived'].includes(patch.state)) throw new Error('Estado no válido.')
  if (patch.metadata && (!Object.keys(patch.metadata).every(key => ['celebrationMode', 'effectType', 'family', 'modes', 'category', 'language', 'style', 'loop', 'voiceName', 'validUntil', 'text'].includes(key)))) throw new Error('No se puede cambiar la procedencia del audio.')
  const old: AudioMetadata = JSON.parse(row.metadataJSON)
  if (row.kind === 'voice' && old.origin === 'generated' && patch.metadata?.text !== undefined && patch.metadata.text !== old.text) throw new Error('Cree otra versión para cambiar el texto hablado.')
  const metadata = patch.metadata ? validateMetadata(row.kind, { ...old, ...patch.metadata }) : old
  if (row.kind === 'effect' && (old.effectType ?? 'short') !== (metadata.effectType ?? 'short')) {
    if (old.origin === 'generated' && row.preparation !== 'ready') throw new Error('El audio generado debe estar disponible antes de cambiar su tipo.')
    if (['queued', 'generating', 'preparing'].includes(row.preparation)) throw new Error('Espere a que termine la preparación del audio.')
    assertResourceUnused(roomId, id)
    if (row.preparation === 'ready' && row.durationMs! > clipDurationLimit(row.kind, metadata.effectType)) throw new Error(old.origin === 'generated' ? 'El archivo supera el límite del nuevo tipo. Cree otra versión más corta.' : 'El archivo supera el límite del nuevo tipo. Use Reemplazar archivo para cambiar el tipo y el audio juntos.')
  }
  db.run('UPDATE audioResources SET title=?,state=?,metadataJSON=?,updatedAt=? WHERE id=?', [title.trim(), patch.state ?? row.state, JSON.stringify(metadata), Date.now(), id])
  return resourceDTO(getResource(id)!)
}
export function listResources (roomId: number, query: Record<string, unknown>): ResourcePage {
  const clauses = [resourceRoomFilter, 'deletedAt IS NULL']
  const params: unknown[] = [roomId, roomId]
  const kind = query.kind ?? 'voice'
  if (!['voice', 'effect', 'ambience'].includes(String(kind))) throw new Error('Tipo de audio no válido.')
  clauses.push('kind=?')
  params.push(kind)
  if (query.resourceId) {
    clauses.push('id=?')
    params.push(String(query.resourceId))
  }
  if (query.state && query.state !== 'all') {
    if (!['active', 'disabled', 'archived'].includes(String(query.state))) throw new Error('Estado no válido.')
    clauses.push('state=?')
    params.push(query.state)
  } else if (query.state !== 'all') clauses.push('state!=\'archived\'')
  if (query.search) {
    clauses.push('(title LIKE ? ESCAPE \'\\\' OR json_extract(metadataJSON,\'$.text\') LIKE ? ESCAPE \'\\\')')
    const term = `%${String(query.search).slice(0, 200).replace(/[\\%_]/g, '\\$&')}%`
    params.push(term, term)
  }
  for (const field of ['family', 'category', 'language', 'providerId', 'origin', 'style', 'voiceName'] as const) {
    if (query[field]) {
      clauses.push(`json_extract(metadataJSON,'$.${field}')=?`)
      params.push(field === 'category' && kind === 'effect' ? effectCategoryValue(String(query[field]).slice(0, 120)) : String(query[field]).slice(0, 120))
    }
  }
  if (query.profile) {
    clauses.push('EXISTS(SELECT 1 FROM json_each(json_extract(metadataJSON,\'$.modes\')) WHERE value=?)')
    params.push(String(query.profile))
  }
  if (query.loop === 'true' || query.loop === 'false') {
    clauses.push('json_extract(metadataJSON,\'$.loop\')=?')
    params.push(Number(query.loop === 'true'))
  }
  const sort = { title: 'title COLLATE NOCASE', duration: 'durationMs', created: 'createdAt', state: 'state' }[String(query.sort ?? 'created')]
  if (!sort) throw new Error('Orden no válido.')
  const direction = query.direction === 'asc' ? 'ASC' : 'DESC'
  const pageSize = 20
  const total = db.get<{ count: number }>(`SELECT count(*) count FROM audioResources WHERE ${clauses.join(' AND ')}`, params)!.count
  const page = Math.min(Math.max(1, Math.floor(Number(query.page) || 1)), Math.max(1, Math.ceil(total / pageSize)))
  const items = db.all<StoredResource>(`SELECT * FROM audioResources WHERE ${clauses.join(' AND ')} ORDER BY ${sort} ${direction},id ASC LIMIT ? OFFSET ?`, [...params, pageSize, (page - 1) * pageSize]).map(row => resourceDTO(row))
  const usage = audioUsage(roomId, items.map(item => item.id))
  for (const item of items) item.usage = usage[item.id]
  const counts = { voice: 0, effect: 0, ambience: 0 }
  for (const row of db.all<{ kind: AudioKind, count: number }>(`SELECT kind,count(*) count FROM audioResources WHERE ${resourceRoomFilter} AND state!='archived' AND deletedAt IS NULL GROUP BY kind`, [roomId, roomId])) counts[row.kind] = row.count
  return { items, total, page, pageSize, counts }
}
export function resourceClip (row: StoredResource): AnimationClip {
  const m: AudioMetadata = JSON.parse(row.metadataJSON)
  return { id: row.id, title: row.title, kind: row.kind, effectType: m.effectType, category: m.category, displayText: row.kind === 'voice' ? withoutAudioTags(m.text) || row.title : row.title,
    checksum: row.checksum!, durationMs: row.durationMs!, source: m.source ?? m.providerId ?? m.origin, license: m.license ?? 'Local audio',
    family: m.effectType === 'transition' ? 'manual' : m.family, celebrationMode: m.celebrationMode, modes: m.modes, approvedForAuto: m.automatic === true, validUntil: m.validUntil, loop: m.loop,
    ...(row.roomId !== null ? { roomId: row.roomId } : {}) }
}
