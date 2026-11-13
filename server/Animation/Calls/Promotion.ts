import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { parseBuffer } from 'music-metadata'
import { db } from '../../lib/Database.js'
import Tables from '../../Tables/Tables.js'
import type { GreetingVoiceProfile } from '../../Greetings/voiceProfile.js'
import { greetingVoiceModels } from '../../../shared/greetingVoice.js'
import { callText } from '../../../shared/karaokeCalls.js'
import NameBank, { type NameMetadata } from './NameBank.js'
import type CallJobs from './Jobs.js'
import { CallError } from './Jobs.js'
import { checksum } from './Composition.js'
import { key, partDTO, partProfile, type PartRow } from './Store.js'

const run = promisify(execFile)
export interface CallPromotionResource {
  type: 'name' | 'listening'
  sourceId: string
  text: string
  aliases?: string[]
  enabled?: boolean
  archived?: boolean
  tag: string
  profile: GreetingVoiceProfile | null
  metadata: NameMetadata | null
  part: (ReturnType<typeof partDTO> & { checksum: string, masterChecksum: string }) | null
}
interface TemplateRow { id: string, text: string, enabled: number, revision: number, partId: string | null }
const partInfo = (row?: PartRow) => row ? { ...partDTO(row), checksum: row.checksum, masterChecksum: row.masterChecksum } : null
const selectedRow = (id: string | null) => id ? db.get<PartRow>('SELECT * FROM karaokeCallParts WHERE id=? AND retired=0', [id]) : undefined

export function callPromotionSnapshot (roomId: number, profile: GreetingVoiceProfile) {
  Tables.room(roomId)
  const names: CallPromotionResource[] = db.all<{ id: string }>('SELECT id FROM namePronunciations ORDER BY createdAt,id').map(({ id }) => {
    const detail = NameBank.detail(id, profile)
    const row = detail.active ? selectedRow(detail.active.part.id) : undefined
    const metadata = row ? NameBank.info(row) : null
    return { type: 'name', sourceId: id, text: detail.spokenText, aliases: detail.aliases, archived: detail.archived,
      tag: key([detail.revision, detail.spokenText, detail.aliases, detail.archived, row?.id ?? null]), profile: metadata?.profile ?? null, metadata, part: partInfo(row) }
  })
  const listening: CallPromotionResource[] = db.all<TemplateRow>('SELECT * FROM listeningTemplates WHERE roomId=? AND archived=0 ORDER BY createdAt,id', [roomId]).map((item) => {
    const row = selectedRow(item.partId)
    const ready = row?.kind === 'template' && row.roomId === roomId && row.text === item.text ? row : undefined
    return { type: 'listening', sourceId: item.id, text: item.text, enabled: !!item.enabled,
      tag: key([item.revision, item.text, item.enabled, item.partId]), profile: ready ? partProfile(ready, profile) : null, metadata: null, part: partInfo(ready) }
  })
  return { profile, names, listening }
}

export const matchingCallResource = (items: CallPromotionResource[], source: CallPromotionResource) =>
  items.find(item => item.sourceId === source.sourceId) ?? items.find(item => item.text.normalize('NFC').toLocaleLowerCase('es') === source.text.normalize('NFC').toLocaleLowerCase('es'))

export function sameCallResource (target: CallPromotionResource, source: CallPromotionResource) {
  return target.type === source.type && target.text === source.text && !!target.part && !!source.part
    && target.part.checksum === source.part.checksum && target.part.masterChecksum === source.part.masterChecksum && target.part.profileKey === source.part.profileKey
    && (source.type === 'listening' ? target.enabled === source.enabled : !target.archived && (source.aliases ?? []).every(alias => target.aliases?.includes(alias)))
}

function validateSource (source: CallPromotionResource, profile: GreetingVoiceProfile) {
  const media = source?.part
  const original = source?.profile
  if (!source || !['name', 'listening'].includes(source.type) || !/^[\w-]{1,100}$/.test(source.sourceId) || !media || !original
    || original.provider !== 'gemini' || !greetingVoiceModels.includes(original.model as typeof greetingVoiceModels[number])
    || typeof original.voice !== 'string' || !/^[\w-]{1,100}$/.test(original.voice) || typeof original.style !== 'string' || original.style.length > 3000 || original.processingRevision !== 1
    || media.profileKey !== key(original) || media.kind !== (source.type === 'name' ? 'name' : 'template') || media.text !== source.text
    || !Number.isInteger(media.durationMs) || media.durationMs <= 0 || media.durationMs > 10000
    || !/^[a-f0-9]{64}$/.test(media.checksum) || !/^[a-f0-9]{64}$/.test(media.masterChecksum)
    || callText(source.text, source.type === 'name' ? 24 : 100) !== source.text || callText(media.title, 100) !== media.title) throw new CallError('El recurso de voz no es válido.')
  if (source.type === 'name') {
    const metadata = source.metadata
    if (!metadata || key(metadata.profile) !== key(original) || typeof metadata.legacy !== 'boolean'
      || (metadata.style !== null && (typeof metadata.style !== 'string' || metadata.style.length > 3000))
      || (metadata.recipeRevision !== null && (!Number.isSafeInteger(metadata.recipeRevision) || metadata.recipeRevision < 1))
      || !Array.isArray(source.aliases) || source.aliases.length > 100 || source.aliases.some(alias => typeof alias !== 'string') || source.archived !== false
      || !NameBank.compatible({ profileKey: media.profileKey, nameMetadataJSON: JSON.stringify(metadata) } as PartRow, profile)) throw new CallError('La pronunciación no coincide con el perfil de voz del destino.')
  } else if (typeof source.enabled !== 'boolean') throw new CallError('La introducción no es válida.')
}

// Publish exact validated masters and derivatives; never call a TTS provider or
// transcode approved recordings. Each binding is committed after both files.
export async function importCallResource (worker: CallJobs, roomId: number, profile: GreetingVoiceProfile,
  source: CallPromotionResource, expectedTag: string | null, master: Buffer, audio: Buffer) {
  Tables.room(roomId)
  validateSource(source, profile)
  if (expectedTag !== null && (typeof expectedTag !== 'string' || !/^[a-f0-9]{64}$/.test(expectedTag))) throw new CallError('La comparación de destino no es válida.')
  if (!master.length || !audio.length || master.length > 20 * 1024 * 1024 || audio.length > 5 * 1024 * 1024
    || checksum(master) !== source.part!.masterChecksum || checksum(audio) !== source.part!.checksum) throw new CallError('Los archivos no coinciden con la comparación aprobada.')
  const current = () => matchingCallResource(callPromotionSnapshot(roomId, profile)[source.type === 'name' ? 'names' : 'listening'], source)
  let target = current()
  if (target && sameCallResource(target, source)) {
    await worker.bytes(roomId, target.part!.id, true)
    await worker.bytes(roomId, target.part!.id)
    return target
  }
  if ((target?.tag ?? null) !== expectedTag) throw new CallError('El destino cambió. Compare de nuevo antes de publicar.', 409)
  const [wave, mp3] = await Promise.all([parseBuffer(master, undefined, { duration: true }), parseBuffer(audio, undefined, { duration: true })])
  if (wave.format.container?.toLowerCase() !== 'wave' || mp3.format.container !== 'MPEG' || wave.format.sampleRate !== 24000 || wave.format.numberOfChannels !== 1
    || !wave.format.duration || wave.format.duration > 10 || !mp3.format.duration || mp3.format.duration > 10
    || Math.abs(Math.ceil(mp3.format.duration * 1000) - source.part!.durationMs) > 2 || Math.abs(wave.format.duration - mp3.format.duration) > 0.25) throw new CallError('El formato o la duración de las piezas no es válido.')
  const identity = key([source.type === 'name' ? null : roomId, source.type, source.text, source.part!.title, source.part!.profileKey, source.part!.checksum, source.part!.masterChecksum, source.metadata])
  const id = `${identity.slice(0, 8)}-${identity.slice(8, 12)}-${identity.slice(12, 16)}-${identity.slice(16, 20)}-${identity.slice(20, 32)}`
  const masterFile = `masters/${id}.wav`
  const audioFile = `production/${id}.mp3`
  const staging = await fs.mkdtemp(path.join(worker.directory, '.promotion-'))
  try {
    for (const [name, bytes] of [['master.wav', master], ['audio.mp3', audio]] as const) {
      const file = path.join(staging, name)
      await fs.writeFile(file, bytes)
      await run(process.env.KES_FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-xerror', '-protocol_whitelist', 'file,pipe', '-i', file, '-f', 'null', '-'], { timeout: 30000, maxBuffer: 16384 })
    }
    await fs.mkdir(path.join(worker.directory, 'masters'), { recursive: true })
    await fs.mkdir(path.join(worker.directory, 'production'), { recursive: true })
    // Immutable names allow concurrent identical attempts without truncating a
    // file already being read. Existing files must match, never be overwritten.
    for (const [staged, relative, expected] of [['master.wav', masterFile, source.part!.masterChecksum], ['audio.mp3', audioFile, source.part!.checksum]]) {
      const destination = path.join(worker.directory, relative)
      try {
        await fs.link(path.join(staging, staged), destination)
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
      if (checksum(await fs.readFile(destination)) !== expected) throw new CallError('Un archivo del destino cambió. Revise antes de reintentar.', 409)
    }
    target = current()
    if (target && sameCallResource(target, source)) return target
    if ((target?.tag ?? null) !== expectedTag) throw new CallError('El destino cambió durante la carga. Compare de nuevo.', 409)
    db.exec('SAVEPOINT call_promotion')
    try {
      let nameId: string | null = null
      if (source.type === 'name') {
        const group = NameBank.ensure(source.text)
        if (group.archived) throw new CallError('La pronunciación está archivada en destino.', 409)
        const detail = NameBank.detail(group.id, profile)
        const aliases = [...new Set([...detail.aliases, ...source.aliases!])]
        NameBank.update(group.id, { spokenText: source.text, aliases, archived: false, revision: group.revision })
        nameId = group.id
      }
      const existing = db.get<PartRow>('SELECT * FROM karaokeCallParts WHERE id=?', [id])
      if (existing?.retired || (existing && (existing.roomId !== (nameId ? null : roomId) || existing.nameId !== nameId))) throw new CallError('El recurso fue retirado o pertenece a otro destino.', 409)
      db.run(`INSERT OR IGNORE INTO karaokeCallParts(id,roomId,kind,variantId,title,text,profileKey,cacheKey,master,filename,checksum,masterChecksum,durationMs,dependenciesJSON,createdAt,nameId,nameSelected,nameMetadataJSON)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'[]',?,?,0,?)`, [id, nameId ? null : roomId, source.type === 'name' ? 'name' : 'template', id, source.part!.title, source.text,
        source.part!.profileKey, `promoted-${identity}`, masterFile, audioFile, source.part!.checksum, source.part!.masterChecksum, source.part!.durationMs, Date.now(), nameId, source.metadata ? JSON.stringify(source.metadata) : null])
      db.run('UPDATE karaokeCallParts SET profileJSON=? WHERE id=?', [JSON.stringify(source.profile), id])
      if (nameId) NameBank.choose(nameId, id, NameBank.get(nameId).revision)
      else {
        if (target) db.run('UPDATE listeningTemplates SET text=?,enabled=?,partId=?,jobId=NULL,revision=revision+1 WHERE roomId=? AND id=?', [source.text, Number(source.enabled), id, roomId, target.sourceId])
        else db.run('INSERT INTO listeningTemplates(id,roomId,text,enabled,partId,createdAt) VALUES(?,?,?,?,?,?)', [`promoted-template-${key([roomId, source.sourceId]).slice(0, 48)}`, roomId, source.text, Number(source.enabled), id, Date.now()])
      }
      db.exec('RELEASE call_promotion')
    } catch (error) {
      db.exec('ROLLBACK TO call_promotion; RELEASE call_promotion')
      throw error
    }
    return current()!
  } finally { await fs.rm(staging, { recursive: true, force: true }) }
}
