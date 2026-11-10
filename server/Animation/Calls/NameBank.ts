import { randomUUID } from 'node:crypto'
import { db } from '../../lib/Database.js'
import { normalizeGuestName, guestNameError, spokenGuestName } from '../../../shared/guestName.js'
import { nameVoiceModels, type NameVoiceDetail, type NamePronunciation, type NameVoiceVersion } from '../../../shared/nameVoices.js'
import type { GreetingVoiceProfile } from '../../Greetings/voiceProfile.js'
import type CallJobs from './Jobs.js'
import { key, partDTO, jobDTO, type PartRow, type JobRow } from './Store.js'

interface NameRow { id: string, spokenText: string, archived: number, revision: number, createdAt: number, updatedAt: number }
export interface NameMetadata {
  profile: GreetingVoiceProfile | null
  style: string | null
  recipeRevision: number | null
  legacy: boolean
  reprocessedFrom?: string
}
export class NameVoiceError extends Error {
  constructor (message: string, readonly status = 422, readonly conflicts: string[] = []) { super(message) }
}
export const nameAliasKey = (name: string) => normalizeGuestName(name).toLocaleLowerCase('es')
// Both 3.8 TTS variants use the same voice library. Choosing a generation model
// must not invalidate an approved name or mix different voices/providers.
const compatibleModels = (model: string) => nameVoiceModels.some(value => value === model) ? nameVoiceModels : [model]
const voiceIdentity = (profile: GreetingVoiceProfile) => key([profile.provider, compatibleModels(profile.model), profile.voice, profile.processingRevision])
const metadata = (part: PartRow): NameMetadata => part.nameMetadataJSON ? JSON.parse(part.nameMetadataJSON) : { profile: null, style: null, recipeRevision: null, legacy: true }
const nameText = (value: unknown) => {
  const error = guestNameError(value)
  if (error) throw new NameVoiceError(error)
  return normalizeGuestName(value as string)
}

/** Global identity and immutable audio versions; synthesis stays in CallJobs. */
export default class NameBank {
  static speechName (value: string) {
    if (guestNameError(value)) return spokenGuestName(value)
    return NameBank.find(value) ? normalizeGuestName(value) : spokenGuestName(value)
  }

  static get (id: string) {
    const row = db.get<NameRow>('SELECT * FROM namePronunciations WHERE id=?', [id])
    if (!row) throw new NameVoiceError('No se encontró la pronunciación.', 404)
    return row
  }

  static find (name: string) {
    const alias = db.get<NameRow>('SELECT n.* FROM namePronunciations n JOIN nameVoiceAliases a ON a.nameId=n.id WHERE a.aliasKey=?', [nameAliasKey(name)])
    // Exact normalized spelling remains reusable even when its explicit alias
    // was removed. An explicit reassignment always wins over this fallback.
    return alias ?? db.all<NameRow>('SELECT * FROM namePronunciations ORDER BY createdAt,id').find(row => nameAliasKey(row.spokenText) === nameAliasKey(name))
  }

  static ensure (text: string, legacy = false) {
    const existing = NameBank.find(text)
    if (existing) return existing
    const spokenText = legacy ? normalizeGuestName(text) : nameText(text)
    const id = randomUUID()
    const now = Date.now()
    db.exec('SAVEPOINT name_create')
    try {
      db.run('INSERT INTO namePronunciations(id,spokenText,archived,createdAt,updatedAt) VALUES(?,?,?,?,?)', [id, spokenText, legacy && guestNameError(spokenText) ? 1 : 0, now, now])
      db.run('INSERT INTO nameVoiceAliases(aliasKey,label,nameId) VALUES(?,?,?)', [nameAliasKey(spokenText), spokenText, id])
      db.exec('RELEASE name_create')
    } catch (error) {
      db.exec('ROLLBACK TO name_create; RELEASE name_create')
      throw error
    }
    return NameBank.get(id)
  }

  static selected (name: string, profile: GreetingVoiceProfile) {
    const group = NameBank.find(name)
    return group && !group.archived ? NameBank.selectedFor(group.id, profile) : undefined
  }

  static pronouncedText (name: string, profile: GreetingVoiceProfile) {
    return NameBank.selected(name, profile)?.text ?? NameBank.find(name)?.spokenText ?? name
  }

  static selectedFor (id: string, profile: GreetingVoiceProfile) {
    return db.all<PartRow>(`SELECT * FROM karaokeCallParts WHERE nameId=? AND kind='name'
      AND roomId IS NULL AND nameSelected=1 AND retired=0 ORDER BY createdAt DESC,id`, [id]).find(part => NameBank.compatible(part, profile))
  }

  static compatible (part: PartRow, profile: GreetingVoiceProfile) {
    const original = metadata(part).profile
    return part.profileKey === key(profile) || (!!original && voiceIdentity(original) === voiceIdentity(profile))
  }

  static latestJob (id: string, profile?: GreetingVoiceProfile) {
    return db.all<JobRow>(`SELECT * FROM karaokeCallJobs WHERE operation='source' AND json_extract(inputJSON,'$.sourceKind')='name'
      AND json_extract(inputJSON,'$.nameId')=? ORDER BY rowid DESC`, [id]).find(row => !profile || voiceIdentity(JSON.parse(row.profileJSON)) === voiceIdentity(profile))
  }

  static preparationIssue (name: string, profile: GreetingVoiceProfile) {
    const group = NameBank.find(name)
    if (!group) return null
    if (group.archived) return 'La pronunciación está archivada. Reactívela en Animador → Nombres.'
    if (NameBank.selectedFor(group.id, profile)) return null
    const job = NameBank.latestJob(group.id, profile)
    if (job?.status === 'ready') return 'Seleccione una versión de esta pronunciación en Animador → Nombres.'
    if (job && ['failed', 'uncertain', 'cancelled'].includes(job.status)) return `${job.error ?? 'La voz no está disponible.'} Revise la pronunciación en Animador → Nombres.`
    return null
  }

  static ensureAudio (worker: CallJobs, roomId: number, text: string, profile: GreetingVoiceProfile, canGenerate: boolean) {
    const group = NameBank.ensure(text)
    if (group.archived) return undefined
    const selected = NameBank.selectedFor(group.id, profile)
    if (selected) return selected
    // A candidate or an uncertain provider attempt needs explicit human action.
    if (NameBank.latestJob(group.id, profile) || !canGenerate) return undefined
    try {
      worker.submit(roomId, 'source', { sourceKind: 'name', nameId: group.id, text: group.spokenText,
        requestId: `name-${key([group.id, profile])}` }, undefined, 'setup', 80)
    } catch (error) {
      if ((error as { status?: number }).status !== 409) throw error
    }
    return undefined
  }

  static initialize () {
    const profiles = db.all<{ profileJSON: string }>('SELECT DISTINCT profileJSON FROM karaokeCallJobs')
      .map(row => ({ json: row.profileJSON, value: JSON.parse(row.profileJSON) as GreetingVoiceProfile }))
    db.exec('SAVEPOINT name_import')
    try {
      for (const row of db.all<PartRow>(`SELECT * FROM karaokeCallParts WHERE kind='name' AND nameId IS NULL ORDER BY createdAt DESC,id`)) {
        const group = NameBank.ensure(row.text, true)
        const profile = profiles.find(profile => key(profile.value) === row.profileKey)?.value ?? null
        const selected = !row.retired && !(profile ? NameBank.selectedFor(group.id, profile) : db.get('SELECT 1 FROM karaokeCallParts WHERE nameId=? AND profileKey=? AND nameSelected=1', [group.id, row.profileKey]))
        db.run('UPDATE karaokeCallParts SET roomId=NULL,nameId=?,nameSelected=?,nameMetadataJSON=? WHERE id=?',
          [group.id, selected ? 1 : 0, JSON.stringify({ profile, style: null, recipeRevision: null, legacy: true } satisfies NameMetadata), row.id])
      }
      for (const row of db.all<JobRow>(`SELECT * FROM karaokeCallJobs WHERE operation='source' AND json_extract(inputJSON,'$.sourceKind')='name' AND json_extract(inputJSON,'$.nameId') IS NULL`)) {
        const group = NameBank.ensure(row.text, true)
        db.run(`UPDATE karaokeCallJobs SET inputJSON=json_set(inputJSON,'$.nameId',?) WHERE id=?`, [group.id, row.id])
      }
      db.exec('RELEASE name_import')
    } catch (error) {
      db.exec('ROLLBACK TO name_import; RELEASE name_import')
      throw error
    }
    NameBank.backfillUses()
  }

  static update (id: string, input: { spokenText?: unknown, aliases?: unknown, archived?: unknown, revision?: unknown, reassign?: unknown }) {
    const row = NameBank.get(id)
    if (input.revision !== row.revision) throw new NameVoiceError('La pronunciación cambió. Recargue sus datos antes de guardar.', 409)
    const spokenText = input.spokenText === undefined ? row.spokenText : nameText(input.spokenText)
    if (nameAliasKey(spokenText) !== nameAliasKey(row.spokenText) && db.all<NameRow>('SELECT * FROM namePronunciations WHERE id!=?', [id]).some(other => nameAliasKey(other.spokenText) === nameAliasKey(spokenText))) {
      throw new NameVoiceError('Ya existe una pronunciación con ese texto. Gestione sus nombres asociados desde el banco.')
    }
    if (!Array.isArray(input.aliases) || input.aliases.length > 100 || (input.archived !== undefined && typeof input.archived !== 'boolean')) throw new NameVoiceError('Revise los nombres asociados.')
    const aliases = new Map<string, string>(input.aliases.map((value) => {
      const label = nameText(value)
      return [nameAliasKey(label), label]
    }))
    if (aliases.size > 100) throw new NameVoiceError('Use hasta 100 nombres asociados por pronunciación.')
    const conflicts = [...aliases].filter(([alias]) => {
      const saved = db.get<{ nameId: string }>('SELECT nameId FROM nameVoiceAliases WHERE aliasKey=?', [alias])
      return saved && saved.nameId !== id
    }).map(([, label]) => label)
    if (conflicts.length && input.reassign !== true) throw new NameVoiceError('Algunos nombres ya tienen otra pronunciación. Confirme su reasignación.', 409, conflicts)
    db.exec('SAVEPOINT name_edit')
    try {
      db.run('DELETE FROM nameVoiceAliases WHERE nameId=?', [id])
      for (const [alias, label] of aliases) db.run(`INSERT INTO nameVoiceAliases(aliasKey,label,nameId) VALUES(?,?,?)
        ON CONFLICT(aliasKey) DO UPDATE SET label=excluded.label,nameId=excluded.nameId`, [alias, label, id])
      db.run('UPDATE namePronunciations SET spokenText=?,archived=?,revision=revision+1,updatedAt=? WHERE id=?',
        [spokenText, input.archived === undefined ? row.archived : input.archived ? 1 : 0, Date.now(), id])
      db.exec('RELEASE name_edit')
    } catch (error) {
      db.exec('ROLLBACK TO name_edit; RELEASE name_edit')
      throw error
    }
    return NameBank.get(id)
  }

  static info (part: PartRow) { return metadata(part) }

  static choose (id: string, partId: string, revision: unknown) {
    const group = NameBank.get(id)
    if (revision !== group.revision) throw new NameVoiceError('La pronunciación cambió. Recargue sus datos antes de elegir.', 409)
    const version = db.get<PartRow>(`SELECT * FROM karaokeCallParts WHERE nameId=? AND id=? AND kind='name' AND retired=0`, [id, partId])
    if (!version) throw new NameVoiceError('La versión no está disponible.', 404)
    const originalProfile = metadata(version).profile
    db.exec('SAVEPOINT name_select')
    try {
      db.run('UPDATE karaokeCallParts SET nameSelected=0 WHERE nameId=? AND profileKey=?', [id, version.profileKey])
      if (originalProfile) for (const other of db.all<PartRow>('SELECT * FROM karaokeCallParts WHERE nameId=? AND nameSelected=1', [id])) {
        if (NameBank.compatible(other, originalProfile)) db.run('UPDATE karaokeCallParts SET nameSelected=0 WHERE id=?', [other.id])
      }
      db.run('UPDATE karaokeCallParts SET nameSelected=1 WHERE id=?', [partId])
      db.run('UPDATE namePronunciations SET revision=revision+1,updatedAt=? WHERE id=?', [Date.now(), id])
      db.exec('RELEASE name_select')
    } catch (error) {
      db.exec('ROLLBACK TO name_select; RELEASE name_select')
      throw error
    }
  }

  static detail (id: string, profile: GreetingVoiceProfile): NameVoiceDetail {
    const row = NameBank.get(id)
    const versions = db.all<PartRow & { uses: number, lastUsedAt: number | null }>(`SELECT p.*,count(u.partId) uses,max(u.completedAt) lastUsedAt
      FROM karaokeCallParts p LEFT JOIN nameVoiceUses u ON u.partId=p.id WHERE p.nameId=? GROUP BY p.id ORDER BY p.createdAt DESC,p.id`, [id])
      .map((part): NameVoiceVersion => {
        const info = metadata(part)
        return { part: partDTO(part), selected: !!part.nameSelected, compatible: NameBank.compatible(part, profile), available: !part.retired,
          voice: info.profile?.voice ?? null, model: info.profile?.model ?? null, style: info.style, recipeRevision: info.recipeRevision,
          legacy: info.legacy, uses: part.uses, lastUsedAt: part.lastUsedAt }
      })
    const latest = NameBank.latestJob(id, profile)
    return { ...row, archived: !!row.archived, aliases: db.all<{ label: string }>('SELECT label FROM nameVoiceAliases WHERE nameId=? ORDER BY label', [id]).map(row => row.label),
      versions, active: versions.find(version => version.selected && version.compatible && version.available) ?? null, latest: versions[0] ?? null,
      legacyHistory: versions.some(version => version.legacy), uses: versions.reduce((sum, version) => sum + version.uses, 0),
      lastUsedAt: Math.max(0, ...versions.map(version => version.lastUsedAt ?? 0)) || null, job: latest ? jobDTO(latest, profile) : null }
  }

  static list (profile: GreetingVoiceProfile, input: { q?: unknown, sort?: unknown, archived?: unknown, offset?: unknown } = {}) {
    const query = String(input.q ?? '').normalize('NFC').toLocaleLowerCase('es').trim()
    const offset = Math.floor(Math.max(0, Math.min(100000, Number(input.offset) || 0)))
    const rows = db.all<NameRow & { uses: number, lastUsedAt: number | null, generatedAt: number, aliasesJSON: string }>(`SELECT n.*,coalesce(u.uses,0) uses,u.lastUsedAt,
      coalesce(v.activeCreatedAt,v.latestCreatedAt,0) generatedAt,
      (SELECT json_group_array(label) FROM nameVoiceAliases WHERE nameId=n.id) aliasesJSON FROM namePronunciations n
      LEFT JOIN (SELECT p.nameId,count(u.partId) uses,max(u.completedAt) lastUsedAt FROM karaokeCallParts p JOIN nameVoiceUses u ON u.partId=p.id GROUP BY p.nameId) u ON u.nameId=n.id
      LEFT JOIN (SELECT nameId,max(createdAt) latestCreatedAt,max(CASE WHEN nameSelected=1 AND retired=0 AND (profileKey=? OR
        (json_extract(nameMetadataJSON,'$.profile.provider')=? AND json_extract(nameMetadataJSON,'$.profile.model') IN (SELECT value FROM json_each(?)) AND json_extract(nameMetadataJSON,'$.profile.voice')=? AND json_extract(nameMetadataJSON,'$.profile.processingRevision')=?)) THEN createdAt END) activeCreatedAt
        FROM karaokeCallParts WHERE nameId IS NOT NULL GROUP BY nameId) v ON v.nameId=n.id
      ${input.archived === 'true' ? '' : 'WHERE n.archived=0'}`, [key(profile), profile.provider, JSON.stringify(compatibleModels(profile.model)), profile.voice, profile.processingRevision])
      .filter(row => [row.spokenText, ...JSON.parse(row.aliasesJSON) as string[]].some(name => name.toLocaleLowerCase('es').includes(query)))
    rows.sort((a, b) => {
      if (input.sort === 'uses') return b.uses - a.uses
      if (input.sort === 'lastUsed') return (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0)
      if (input.sort === 'generated') return b.generatedAt - a.generatedAt
      return a.spokenText.localeCompare(b.spokenText, 'es')
    })
    return { items: rows.slice(offset, offset + 50).map((row): NamePronunciation => {
      const { versions, ...item } = NameBank.detail(row.id, profile)
      void versions
      return item
    }), total: rows.length, offset, limit: 50 }
  }

  static sources (partId: string) {
    const visited = new Set<string>()
    const names: PartRow[] = []
    const visit = (id: string) => {
      if (visited.has(id) || visited.size >= 100) return
      visited.add(id)
      const part = db.get<PartRow>('SELECT * FROM karaokeCallParts WHERE id=?', [id])
      if (!part) return
      if (part.kind === 'name' && part.nameId) names.push(part)
      for (const child of JSON.parse(part.dependenciesJSON) as string[]) visit(child)
    }
    visit(partId)
    return names
  }

  static recordUse (executionId: string, assetId: string, partId: string, roomId: number, completedAt: number) {
    for (const name of NameBank.sources(partId)) db.run('INSERT OR IGNORE INTO nameVoiceUses(executionId,assetId,partId,roomId,completedAt) VALUES(?,?,?,?,?)', [executionId, assetId, name.id, roomId, completedAt])
  }

  static backfillUses () {
    for (const row of db.all<{ interventionId: string, roomId: number, finishedAt: number, sequenceJSON: string }>(`SELECT interventionId,roomId,finishedAt,sequenceJSON FROM animationInterventions WHERE status='PLAYED' AND startedAt IS NOT NULL AND finishedAt IS NOT NULL`)) {
      const assets = JSON.parse(row.sequenceJSON) as Array<{ id: string, partId?: string }>
      for (const asset of assets) if (asset.partId && db.get('SELECT 1 FROM audioUsage WHERE roomId=? AND sourceId=? AND clipId=?', [row.roomId, `intervention:${row.interventionId}`, asset.id])) {
        NameBank.recordUse(row.interventionId, asset.id, asset.partId, row.roomId, row.finishedAt)
      }
    }
  }
}
