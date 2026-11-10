import { db } from '../../lib/Database.js'
import type GreetingVoice from '../../Greetings/GreetingVoice.js'
import type { QueueItem } from '../../../shared/types.js'
import { callPlaybackReasons, type CallAsset, type CallContext, type CallPreparation, type CallPurpose, type CallRequestState } from '../../../shared/karaokeCalls.js'
import CallJobs, { CallError } from './Jobs.js'
import { callControls, job, jobDTO, key, part, partDTO, retainedListening, tableVoice, type JobRow, type PartRow } from './Store.js'
import Tables from '../../Tables/Tables.js'
import { callSpeechProfile } from '../../Greetings/voiceProfile.js'
import { compositionRevision } from './Composition.js'
import ListeningTemplates, { defaultListeningTemplates } from './ListeningTemplates.js'
import getLogger from '../../lib/Log.js'
import NameBank from './NameBank.js'

export const listeningTemplates = defaultListeningTemplates
export const listeningTemplate = listeningTemplates[0]
export const isListeningRequest = (item?: QueueItem) => item?.origin === 'PARTICIPANT' && item.requestIntent === 'LISTEN'
interface PresentationRow { inputKey: string, resultId: string | null, signatureId: string | null, startedAt: number | null, templateId: string | null, templatePartId: string | null, playbackReason: keyof typeof callPlaybackReasons | null, recoveryJobId: string | null, namePartId: string | null }

/** Reconciled by CallAutomation; sources share its worker and provider budget. */
export default class ListeningCalls {
  readonly templates: ListeningTemplates
  constructor (private worker: CallJobs, private voice: Pick<GreetingVoice, 'profile' | 'snapshot'>) {
    this.templates = new ListeningTemplates(worker, voice)
  }

  private template (roomId: number, item: QueueItem, started = false) {
    const previous = db.get<PresentationRow>('SELECT * FROM listeningPresentations WHERE roomId=? AND queueId=?', [roomId, item.queueId])
    return this.templates.choose(roomId, previous?.templateId, previous?.templatePartId, started)
  }

  private table (roomId: number, item: QueueItem) {
    if (!item.tableId) return undefined
    try {
      if (Tables.get(roomId, item.tableId).status !== 'active') return undefined
      const saved = tableVoice(roomId, item.tableId, this.voice.profile())
      if (saved.outdated || !saved.part || ![`Mesa ${saved.code}`, `Mesa ${saved.code} ·`].some(label => item.tableLabelSnapshot === label || item.tableLabelSnapshot?.startsWith(`${label} `))) return undefined
      return part(roomId, saved.part.id)
    } catch { return undefined }
  }

  private inputKey (roomId: number, item: QueueItem, template: PartRow | null | undefined = this.template(roomId, item)?.audio, recipe = 'listening-v3', namePartId = NameBank.selected(NameBank.speechName(item.userDisplayName), this.voice.profile())?.id) {
    return key([recipe, item.queueId, item.userDisplayName, item.tableId, item.tableLabelSnapshot,
      item.requestIntent, item.origin, template?.text, this.table(roomId, item)?.id, this.voice.profile(), ...(recipe === 'listening-v3' ? [namePartId] : [])])
  }

  private ensure (roomId: number, operation: 'source' | 'compose', body: Record<string, unknown>, queueId?: number) {
    const sourceCacheKey = operation === 'source' ? key([body.sourceKind, body.text, callSpeechProfile(this.voice.profile(), body.sourceKind as CallPurpose), compositionRevision, null]) : null
    const cached = operation === 'source'
      ? db.get<PartRow>('SELECT * FROM karaokeCallParts WHERE roomId=? AND cacheKey=? AND retired=0', [roomId, sourceCacheKey])
      : db.get<PartRow>('SELECT * FROM karaokeCallParts WHERE roomId=? AND dependenciesJSON=? AND profileKey=? AND retired=0', [roomId, JSON.stringify(body.sourceIds), key(this.voice.profile())])
    if (cached) return cached
    const attempt = db.get<{ setupAttempt: number }>('SELECT setupAttempt FROM karaokeCallControls WHERE roomId=?', [roomId])?.setupAttempt ?? 0
    let requestId = `listening-${key([operation, body, this.voice.profile(), sourceCacheKey, compositionRevision, attempt])}`
    let existing = db.get<JobRow>('SELECT * FROM karaokeCallJobs WHERE roomId=? AND requestId=?', [roomId, requestId])
    let rebuildOf: string | undefined
    if (operation === 'compose' && queueId !== undefined && existing && ['failed', 'uncertain'].includes(existing.status)) {
      // A failed shared receipt is not a cached audio asset. Allow one local
      // rebuild per request; polling/restarts cannot create an endless retry.
      rebuildOf = existing.id
      requestId = `listening-${key([requestId, 'local-rebuild', queueId])}`
      existing = db.get<JobRow>('SELECT * FROM karaokeCallJobs WHERE roomId=? AND requestId=?', [roomId, requestId])
    }
    if (existing) {
      if (existing.status === 'ready' && existing.resultId && part(roomId, existing.resultId)) return part(roomId, existing.resultId)
      // Reassembly is local and safe; never resubmit an uncertain synthesis.
      if (operation === 'compose' && existing.status === 'ready') db.run(`UPDATE karaokeCallJobs SET status='queued',resultId=NULL WHERE id=?`, [existing.id])
      return undefined
    }
    if (operation === 'source' && (!this.voice.snapshot().config.enabled || !this.voice.snapshot().configured)) return undefined
    try {
      const submitted = this.worker.submit(roomId, operation, { ...body, requestId }, undefined, 'setup', 80)
      if (rebuildOf) getLogger('calls').info('Local composition rebuild room=%s queue=%s originalJob=%s job=%s', roomId, queueId, rebuildOf, submitted.id)
    } catch (error) {
      if (!(error instanceof CallError && error.status === 409)) throw error
    }
    return undefined
  }

  private source (roomId: number, sourceKind: CallPurpose, text: string) {
    if (sourceKind === 'name') return NameBank.ensureAudio(this.worker, roomId, text, this.voice.profile(), this.voice.snapshot().configured && this.voice.snapshot().config.enabled)
    return this.ensure(roomId, 'source', { sourceKind, text })
  }

  reconcile (roomId: number, items: QueueItem[]) {
    const enabled = callControls(roomId).listeningEnabled
    const greetingsEnabled = !!db.get(`SELECT 1 FROM greetingControls WHERE roomId=? AND audioEnabled=1 AND paused=0 AND json_extract(playbackJSON,'$.enabled')=1`, [roomId])
    if (!enabled && !greetingsEnabled) return
    if (enabled) this.templates.reconcile(roomId)
    for (const item of items.filter(item => item.origin === 'PARTICIPANT' && item.status === 'APPROVED')) {
      // A reserved/displaying greeting still owns its attribution. Dropping the
      // signature here invalidates its reservation before STARTED can arrive.
      const greeting = greetingsEnabled && db.get(`SELECT 1 FROM greetings WHERE roomId=? AND queueId=? AND status IN ('QUEUED','RESERVED','DISPLAYING')`, [roomId, item.queueId])
      const selected = this.template(roomId, item)
      const present = enabled && isListeningRequest(item) && !!selected
      if (!present && !greeting) continue
      const previous = db.get<PresentationRow>('SELECT * FROM listeningPresentations WHERE roomId=? AND queueId=?', [roomId, item.queueId])
      if (previous?.startedAt) continue
      const inputKey = this.inputKey(roomId, item, selected?.audio ?? null)
      const name = present || greeting ? this.source(roomId, 'name', NameBank.speechName(item.userDisplayName)) : undefined
      const prefix = greeting ? this.source(roomId, 'signature', 'De') : undefined
      const template = present ? selected?.audio : undefined
      const signature = name && prefix ? this.ensure(roomId, 'compose', { sourceIds: [prefix.id, name.id], sourceKind: 'signature' }, item.queueId) : undefined
      const table = this.table(roomId, item)
      const result = name && template ? this.ensure(roomId, 'compose', { sourceIds: [...(table ? [table.id] : []), template.id, name.id] }, item.queueId) : undefined
      db.run(`INSERT INTO listeningPresentations(roomId,queueId,inputKey,resultId,signatureId,templateId,templatePartId,namePartId) VALUES(?,?,?,?,?,?,?,?)
        ON CONFLICT(roomId,queueId) DO UPDATE SET inputKey=excluded.inputKey,resultId=excluded.resultId,signatureId=excluded.signatureId,templateId=excluded.templateId,templatePartId=excluded.templatePartId,namePartId=excluded.namePartId`,
      [roomId, item.queueId, inputKey, result?.id ?? null, signature?.id ?? null, selected?.id ?? null, selected?.audio?.id ?? null, name?.id ?? null])
    }
  }

  preparation (roomId: number, item: QueueItem, allowStarted = false): CallPreparation | null {
    if (item.status !== 'APPROVED' || item.origin !== 'PARTICIPANT') return null
    const row = db.get<PresentationRow>('SELECT * FROM listeningPresentations WHERE roomId=? AND queueId=?', [roomId, item.queueId])
    const template = this.template(roomId, item, allowStarted)?.audio ?? null
    if (!row || (row.startedAt && !allowStarted)) return null
    const namePartId = allowStarted && row.startedAt
      ? row.namePartId ?? NameBank.sources(row.resultId ?? row.signatureId ?? '')[0]?.id
      : NameBank.selected(NameBank.speechName(item.userDisplayName), this.voice.profile())?.id
    let inputKey = this.inputKey(roomId, item, template, 'listening-v3', namePartId)
    // A confirmed legacy sequence finishes with its original composition.
    if (allowStarted && row.startedAt && row.inputKey === this.inputKey(roomId, item, template, 'listening-v1')) inputKey = row.inputKey
    if (allowStarted && row.startedAt && row.inputKey === this.inputKey(roomId, item, template, 'listening-v2')) inputKey = row.inputKey
    const signatureKey = key(['signature-v2', item.queueId, item.userDisplayName, item.origin, item.requestIntent, this.voice.profile(), namePartId])
    const controls = callControls(roomId)
    const assets: CallAsset[] = []
    const add = (id: string | null, role: 'call' | 'signature') => {
      const audio = id && part(roomId, id)
      if (!audio || audio.profileKey !== key(this.voice.profile())) return
      if (role === 'signature' && (!namePartId || !NameBank.sources(audio.id).some(source => source.id === namePartId))) return
      assets.push({ id: `call-${audio.id}`, partId: audio.id, role, identifiesSender: true, title: audio.title, displayText: audio.text,
        durationMs: audio.durationMs, checksum: audio.checksum, kind: 'voice', source: 'Gemini', license: 'Generated with the configured provider.',
        url: `api/rooms/${roomId}/karaoke-calls/requests/${item.queueId}/audio/${audio.id}` })
    }
    if (row.inputKey === inputKey && (controls.listeningEnabled || (allowStarted && row.startedAt)) && isListeningRequest(item)) add(row.resultId, 'call')
    const greeting = db.get(`SELECT 1 FROM greetings WHERE roomId=? AND queueId=? AND (status IN ('QUEUED','RESERVED','DISPLAYING') OR (?=1 AND status='DISPLAYED'))`, [roomId, item.queueId, allowStarted ? 1 : 0])
    if (greeting) add(row.signatureId, 'signature')
    if (!assets.length) return null
    const identifiesRequest = assets.some(asset => asset.role === 'call')
    return { kind: identifiesRequest ? 'listening' : 'signature', queueId: item.queueId, inputKey: identifiesRequest ? inputKey : signatureKey, signatureKey,
      revision: controls.revision, assets, reason: null }
  }

  valid (roomId: number, item: QueueItem, context: CallContext, started: boolean) {
    const prepared = this.preparation(roomId, item, started)
    return !!prepared && (context.kind === 'signature' ? prepared.signatureKey : prepared.inputKey) === context.inputKey
      && (context.kind === 'signature' || started || prepared.revision === context.revision)
      && prepared.assets.some(asset => asset.partId === context.partId && (context.kind !== 'signature' || asset.role === 'signature'))
  }

  started (roomId: number, queueId: number) {
    db.run('UPDATE listeningPresentations SET startedAt=COALESCE(startedAt,?) WHERE roomId=? AND queueId=?', [Date.now(), roomId, queueId])
  }

  prioritize (roomId: number, item: QueueItem) {
    const name = NameBank.pronouncedText(NameBank.speechName(item.userDisplayName), this.voice.profile())
    const template = this.template(roomId, item)?.text ?? ''
    const text = [this.table(roomId, item)?.text, template, name].filter(Boolean).join(' ')
    db.run(`UPDATE karaokeCallJobs SET priority=100 WHERE roomId=? AND status='queued' AND operation IN ('source','compose') AND text IN (?,?,?,?,?)`,
      [roomId, name, template, 'De', `De ${name}`, text])
  }

  async recover (roomId: number, queueId: number, input: { requestId?: unknown }) {
    const saved = db.get<PresentationRow>(`SELECT p.* FROM listeningPresentations p JOIN queue q USING(queueId)
      WHERE p.roomId=? AND q.roomId=? AND p.queueId=? AND q.historyClearedAt IS NULL AND q.status NOT IN ('APPROVED','PLAYING','REMOVED','REJECTED')`, [roomId, roomId, queueId])
    if (!saved || !retainedListening(roomId).some(row => row.queueId === queueId)) throw new CallError('El pedido no está disponible en el historial.', 404)
    const result = await this.worker.recover(roomId, saved.resultId ?? '', input.requestId)
    db.run('UPDATE listeningPresentations SET recoveryJobId=?,resultId=COALESCE(?,resultId) WHERE roomId=? AND queueId=?',
      [result.id, result.result?.id ?? null, roomId, queueId])
    return result
  }

  states (roomId: number, items: QueueItem[]): CallRequestState[] {
    const retained = new Set(retainedListening(roomId).map(row => row.queueId))
    return items.filter(item => isListeningRequest(item) && retained.has(item.queueId)).flatMap((item) => {
      const row = db.get<PresentationRow>('SELECT * FROM listeningPresentations WHERE roomId=? AND queueId=?', [roomId, item.queueId])
      if (!row) return []
      const pending = item.status === 'APPROVED' || item.status === 'PLAYING'
      const result = (!pending || row.startedAt || row.inputKey === this.inputKey(roomId, item)) && row.resultId ? part(roomId, row.resultId) : undefined
      const recovery = row.recoveryJobId ? job(roomId, row.recoveryJobId) : undefined
      const intervention = db.get<{ status: string, reason: string | null, startedAt: number | null }>(`SELECT status,reason,startedAt FROM animationInterventions WHERE roomId=?
        AND json_extract(callJSON,'$.queueId')=? AND json_extract(callJSON,'$.kind')='listening' ORDER BY requestedAt DESC LIMIT 1`, [roomId, item.queueId])
      const playback: CallRequestState['playback'] = intervention?.status === 'PLAYED'
        ? 'played'
        : intervention && ['RESERVED', 'PLAYING'].includes(intervention.status)
          ? 'playing'
          : intervention ? intervention.startedAt ? 'interrupted' : 'omitted' : !pending || row.playbackReason ? 'omitted' : 'pending'
      const playbackReason = row.playbackReason ? callPlaybackReasons[row.playbackReason] : intervention?.reason ?? (playback === 'omitted' ? 'No se registró la reproducción de esta presentación.' : null)
      const spokenName = NameBank.speechName(item.userDisplayName)
      const name = NameBank.pronouncedText(spokenName, this.voice.profile())
      const template = this.template(roomId, item)?.text ?? ''
      const text = [this.table(roomId, item)?.text, template, name].filter(Boolean).join(' ')
      const preparing = db.get(`SELECT 1 FROM karaokeCallJobs WHERE roomId=? AND operation IN ('source','compose') AND profileJSON=? AND text IN (?,?,?)
        AND status IN ('queued','generating','preparing') LIMIT 1`, [roomId, JSON.stringify(this.voice.profile()), name, template, text])
      const error = preparing
        ? undefined
        : db.get<{ error: string }>(`SELECT error FROM karaokeCallJobs WHERE roomId=? AND operation IN ('source','compose') AND profileJSON=? AND text IN (?,?,?)
          AND status IN ('failed','uncertain') ORDER BY createdAt DESC LIMIT 1`, [roomId, JSON.stringify(this.voice.profile()), name, template, text])
      const nameIssue = NameBank.preparationIssue(spokenName, this.voice.profile())
      let reason: string | null = null
      if (!result) {
        if (!pending) reason = row.resultId ? 'El audio de esta presentación fue retirado.' : 'No se generó una presentación para este pedido.'
        else reason = nameIssue ?? (error ? `${error.error} Use Preparar mesas para reintentar.` : 'Preparando presentación; la música continúa.')
      }
      return [{ queueId: item.queueId, inputKey: row.inputKey, title: item.title, performer: item.userDisplayName, tableLabel: item.tableLabelSnapshot ?? null,
        playback, playbackReason, canRecover: !pending && !result && !!row.resultId,
        recoveryJob: recovery ? jobDTO(recovery, this.voice.profile()) : null,
        status: result ? 'ready' : !pending ? 'cancelled' : error || nameIssue ? 'fallback' : 'preparing', result: result ? partDTO(result) : null, startedAt: row.startedAt,
        reason }]
    })
  }
}
