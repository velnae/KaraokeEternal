import { db } from '../../lib/Database.js'
import type GreetingVoice from '../../Greetings/GreetingVoice.js'
import { callText, type ListeningTemplate } from '../../../shared/karaokeCalls.js'
import CallJobs, { CallError } from './Jobs.js'
import { job, jobOutdated, key, part, partDTO, type PartRow } from './Store.js'

export const defaultListeningTemplates = ['Este pedido llega de parte de…', 'La siguiente canción la eligió…', 'Vamos con el pedido de…'] as const
interface TemplateRow { id: string, roomId: number, text: string, enabled: number, archived: number, revision: number, partId: string | null, jobId: string | null }

/** Metadata belongs to the room; immutable voice sources remain in CallJobs. */
export default class ListeningTemplates {
  constructor (private worker: CallJobs, private voice: Pick<GreetingVoice, 'profile' | 'snapshot'>) {}

  private seed (roomId: number) {
    if (db.get('SELECT 1 FROM listeningTemplates WHERE roomId=? LIMIT 1', [roomId])) return
    for (const [index, text] of defaultListeningTemplates.entries()) {
      const cached = db.get<PartRow>(`SELECT * FROM karaokeCallParts WHERE roomId=? AND kind='template' AND text=? AND retired=0 AND profileKey=? ORDER BY createdAt DESC LIMIT 1`, [roomId, text, key(this.voice.profile())])
      db.run('INSERT OR IGNORE INTO listeningTemplates(id,roomId,text,partId,createdAt) VALUES(?,?,?,?,?)',
        [`listening-default-${roomId}-${index + 1}`, roomId, text, cached?.id ?? null, index + 1])
    }
  }

  private rows (roomId: number) {
    this.seed(roomId)
    return db.all<TemplateRow>('SELECT * FROM listeningTemplates WHERE roomId=? AND archived=0 ORDER BY createdAt,id', [roomId])
  }

  private get (roomId: number, id: string) {
    const row = db.get<TemplateRow>('SELECT * FROM listeningTemplates WHERE roomId=? AND id=? AND archived=0', [roomId, id])
    if (!row) throw new CallError('La introducción ya no está disponible.', 404)
    return row
  }

  private settle (row: TemplateRow) {
    const pending = row.jobId ? job(row.roomId, row.jobId) : undefined
    if (pending?.status === 'ready' && !jobOutdated(pending, this.voice.profile()) && pending.text === row.text && pending.resultId && part(row.roomId, pending.resultId)) {
      if (row.partId !== pending.resultId) {
        row.partId = pending.resultId
        db.run('UPDATE listeningTemplates SET partId=? WHERE roomId=? AND id=? AND jobId=?', [row.partId, row.roomId, row.id, pending.id])
      }
    }
    return row
  }

  private dto (input: TemplateRow): ListeningTemplate {
    const row = this.settle(input)
    const audio = row.partId ? part(row.roomId, row.partId) : undefined
    const compatible = audio?.profileKey === key(this.voice.profile())
    const pending = row.jobId ? job(row.roomId, row.jobId) : undefined
    const current = pending && !jobOutdated(pending, this.voice.profile())
    return { id: row.id, text: row.text, revision: row.revision, enabled: !!row.enabled,
      audio: audio && compatible ? partDTO(audio) : null,
      status: current ? pending.status : compatible && audio?.text === row.text ? 'ready' : 'waiting',
      error: current ? pending.error : null }
  }

  list (roomId: number) { return this.rows(roomId).map(row => this.dto(row)) }

  reconcile (roomId: number) {
    for (const row of this.rows(roomId)) {
      const state = this.dto(row)
      if (!row.enabled || (state.audio?.text === row.text && state.status === 'ready')) continue
      const pending = row.jobId ? job(roomId, row.jobId) : undefined
      if (pending && !jobOutdated(pending, this.voice.profile())) continue
      if (!this.voice.snapshot().configured || !this.voice.snapshot().config.enabled) continue
      try {
        const submitted = this.worker.submit(roomId, 'source', { sourceKind: 'template', text: row.text,
          requestId: `template-auto-${key([row.id, row.revision, this.voice.profile()])}` }, undefined, 'setup', 80)
        db.run('UPDATE listeningTemplates SET jobId=? WHERE roomId=? AND id=?', [submitted.id, roomId, row.id])
      } catch (error) {
        if (!(error instanceof CallError && error.status === 409)) throw error
      }
    }
  }

  save (roomId: number, id: string | undefined, input: Record<string, unknown>) {
    this.seed(roomId)
    if (typeof input.requestId !== 'string' || !/^[\w-]{8,100}$/.test(input.requestId)) throw new CallError('Identificador de preparación no válido.')
    const text = callText(input.text, 100)
    const targetId = id ?? `template-${key([roomId, input.requestId])}`
    const current = db.get<TemplateRow>('SELECT * FROM listeningTemplates WHERE roomId=? AND id=?', [roomId, targetId])
    const requestId = `template-manual-${key([input.requestId])}`
    const receipt = db.get<{ id: string, text: string }>('SELECT id,text FROM karaokeCallJobs WHERE roomId=? AND requestId=?', [roomId, requestId])
    if (receipt) {
      if (receipt.text !== text || current?.jobId !== receipt.id || current.archived) throw new CallError('La solicitud pertenece a otra versión.', 409)
      return this.dto(current)
    }
    if (id && (!current || current.archived)) throw new CallError('La introducción ya no está disponible.', 404)
    if (current && input.revision !== current.revision) throw new CallError('La introducción cambió. Actualice antes de guardar.', 409)
    const duplicate = this.rows(roomId).find(row => row.id !== targetId && row.text.toLocaleLowerCase('es') === text.toLocaleLowerCase('es'))
    if (duplicate) throw new CallError('Esta introducción ya existe.', 409)
    if (!this.voice.snapshot().configured) throw new CallError('Configure la voz de Gemini antes de generar.')
    const submitted = this.worker.submit(roomId, 'source', { requestId, sourceKind: 'template', text }, undefined, 'preview')
    if (current) db.run('UPDATE listeningTemplates SET text=?,jobId=?,revision=revision+1 WHERE roomId=? AND id=?', [text, submitted.id, roomId, targetId])
    else db.run('INSERT INTO listeningTemplates(id,roomId,text,jobId,createdAt) VALUES(?,?,?,?,?)', [targetId, roomId, text, submitted.id, Date.now()])
    return this.dto(this.get(roomId, targetId))
  }

  configure (roomId: number, id: string, input: Record<string, unknown>) {
    const current = this.get(roomId, id)
    if (input.revision !== current.revision) throw new CallError('La introducción cambió. Actualice antes de guardar.', 409)
    if (typeof input.enabled !== 'boolean' && input.archived !== true) throw new CallError('Revise la configuración de la introducción.')
    db.run('UPDATE listeningTemplates SET enabled=?,archived=?,revision=revision+1 WHERE roomId=? AND id=?',
      [input.archived === true ? 0 : input.enabled ? 1 : 0, input.archived === true ? 1 : 0, roomId, id])
    return input.archived === true ? null : this.dto(this.get(roomId, id))
  }

  choose (roomId: number, previousId?: string | null, previousPartId?: string | null, started = false) {
    const rows = this.rows(roomId)
    const previous = previousId && rows.find(row => row.id === previousId && (row.enabled || started))
    const saved = previousPartId ? part(roomId, previousPartId) : undefined
    if (started && previousPartId && saved?.profileKey === key(this.voice.profile())) return { id: previousId!, text: saved.text, audio: saved }
    if (previous) {
      this.settle(previous)
      const audio = saved?.profileKey === key(this.voice.profile()) ? saved : previous.partId ? part(roomId, previous.partId) : undefined
      if (audio?.profileKey === key(this.voice.profile())) return { id: previous.id, text: audio.text, audio }
      const pending = previous.jobId ? job(roomId, previous.jobId) : undefined
      if (!pending || ['queued', 'generating', 'preparing'].includes(pending.status)) return { id: previous.id, text: previous.text, audio: undefined }
    }
    const candidates = rows.filter(row => row.enabled).map(row => this.settle(row))
    const ready = candidates.filter(row => row.partId && part(roomId, row.partId)?.profileKey === key(this.voice.profile()))
    const selectable = ready.length ? ready : candidates.filter(row => !row.jobId || ['queued', 'generating', 'preparing'].includes(job(roomId, row.jobId)?.status ?? ''))
    const counts = new Map(db.all<{ templateId: string, n: number }>('SELECT templateId,count(*) n FROM listeningPresentations WHERE roomId=? GROUP BY templateId', [roomId]).map(row => [row.templateId, row.n]))
    const selected = selectable.sort((a, b) => (counts.get(a.id) ?? 0) - (counts.get(b.id) ?? 0) || a.id.localeCompare(b.id))[0]
    if (!selected) return null
    const audio = selected.partId ? part(roomId, selected.partId) : undefined
    return { id: selected.id, text: audio?.text ?? selected.text, audio: audio?.profileKey === key(this.voice.profile()) ? audio : undefined }
  }
}
