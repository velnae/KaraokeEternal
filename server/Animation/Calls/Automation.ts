import { db } from '../../lib/Database.js'
import Queue from '../../Queue/Queue.js'
import Tables from '../../Tables/Tables.js'
import getLogger from '../../lib/Log.js'
import type GreetingVoice from '../../Greetings/GreetingVoice.js'
import type { QueueItem } from '../../../shared/types.js'
import { animationPrefs } from '../../../shared/animation.js'
import { callContinuation, callPlaybackReasons, type CallAsset, type CallAutomationSnapshot, type CallContext, type CallControls, type CallPreparation, type CallRequestState } from '../../../shared/karaokeCalls.js'
import { CallError } from './Jobs.js'
import type CallJobs from './Jobs.js'
import { binding, callControls, callSessionAllows, intros, job, jobDTO, jobOutdated, key, part, partDTO, requestCall, retainedSinging, tableVoice, type JobInput, type JobRow, type PartRow, type RequestRow } from './Store.js'
import { compositionRevision } from './Composition.js'
import ListeningCalls from './Listening.js'

const pending = new Set(['queued', 'generating', 'preparing'])
interface FallbackRow { scope: string, inputKey: string, jobId: string | null, resultId: string | null }
const service: { current?: CallAutomation } = {}
export const getCallAutomation = () => service.current
export const isSingingRequest = (item?: QueueItem) => !!item && item.origin !== 'HOUSE' && item.requestIntent === 'SING'

export default class CallAutomation {
  private timer?: ReturnType<typeof setInterval>
  private reconciling = false
  private next = new Map<number, number>()
  readonly listening: ListeningCalls
  constructor (readonly worker: CallJobs, private voice: Pick<GreetingVoice, 'profile' | 'snapshot'>) {
    this.listening = new ListeningCalls(worker, voice)
  }

  start () {
    service.current = this
    this.worker.validateAutomatic = row => this.currentJob(row)
    this.timer = setInterval(() => {
      try {
        this.reconcile()
      } catch (error) {
        getLogger('calls').warn('Call reconciliation failed: %s', (error as Error).message)
      }
    }, 1000)
    this.timer.unref()
    this.reconcile()
  }

  stop () {
    clearInterval(this.timer)
    if (service.current === this) service.current = undefined
    // Shutdown of the owning worker aborts its active provider request.
  }

  private open (roomId: number) { return db.get<{ status: string }>('SELECT status FROM rooms WHERE roomId=?', [roomId])?.status === 'open' }
  private eligible (roomId: number, item?: QueueItem) { return this.open(roomId) && isSingingRequest(item) && item?.status === 'APPROVED' }
  private compatibleIntros (roomId: number) {
    const controls = callControls(roomId)
    return intros(roomId).filter(item => item.profileKey === key(this.voice.profile()) && (!controls.introIds.length || controls.introIds.includes(item.variantId)))
  }

  private table (roomId: number, item: QueueItem) {
    if (!item.tableId) return null
    try {
      const table = Tables.get(roomId, item.tableId)
      const label = `Mesa ${table.code}`
      // The ID selects the table; this comparison only checks its spoken snapshot.
      if (table.status !== 'active' || (item.tableLabelSnapshot !== label && !item.tableLabelSnapshot?.startsWith(`${label} · `))) return null
      return tableVoice(roomId, item.tableId, this.voice.profile())
    } catch { return null }
  }

  private inputKey (roomId: number, item: QueueItem, intro?: PartRow) {
    const table = this.table(roomId, item)
    return key([roomId, item.queueId, item.tableId, item.tableLabelSnapshot, item.userDisplayName, item.title,
      item.origin, item.requestIntent, key(this.voice.profile()), intro?.id, table?.code, table?.revision, table?.part?.id, compositionRevision])
  }

  private chooseIntro (roomId: number, previous?: RequestRow) {
    const candidates = this.compatibleIntros(roomId)
    const pinned = candidates.find(item => item.id === previous?.introId)
    if (pinned) return pinned
    const assignments = db.all<{ introId: string, n: number }>('SELECT introId,count(*) n FROM karaokeCallRequests WHERE roomId=? GROUP BY introId', [roomId])
    const counts = new Map(assignments.map(row => [row.introId, row.n]))
    return candidates.sort((a, b) => (counts.get(a.id) ?? 0) - (counts.get(b.id) ?? 0) || a.createdAt - b.createdAt || a.id.localeCompare(b.id))[0]
  }

  configure (roomId: number, input: unknown): CallControls {
    Tables.room(roomId)
    const value = input as CallControls | null
    const current = callControls(roomId)
    if (!value || value.revision !== current.revision) throw new CallError('Los controles cambiaron. Actualice antes de guardar.', 409)
    if (typeof value.enabled !== 'boolean' || (value.listeningEnabled !== undefined && typeof value.listeningEnabled !== 'boolean') || typeof value.preparing !== 'boolean' || !Array.isArray(value.introIds)
      || value.introIds.length > 20 || value.introIds.some(id => typeof id !== 'string' || !intros(roomId).some(item => item.variantId === id))) throw new CallError('Revise la configuración de llamados.')
    db.run(`INSERT INTO karaokeCallControls(roomId,revision,preparing,enabled,introIdsJSON,listeningEnabled) VALUES(?,?,?,?,?,?)
      ON CONFLICT(roomId) DO UPDATE SET revision=excluded.revision,preparing=excluded.preparing,enabled=excluded.enabled,introIdsJSON=excluded.introIdsJSON,listeningEnabled=excluded.listeningEnabled`,
    [roomId, current.revision + 1, value.preparing || value.enabled ? 1 : 0, value.enabled ? 1 : 0, JSON.stringify([...new Set(value.introIds)]), (value.listeningEnabled ?? current.listeningEnabled) ? 1 : 0])
    this.reconcile()
    return callControls(roomId)
  }

  setup (roomId: number, input: { requestId?: unknown, revision?: unknown }) {
    Tables.room(roomId)
    if (typeof input.requestId !== 'string' || !/^[\w-]{8,100}$/.test(input.requestId)) throw new CallError('Identificador de preparación no válido.')
    if (db.get<{ setupRequestId: string }>('SELECT setupRequestId FROM karaokeCallControls WHERE roomId=?', [roomId])?.setupRequestId === input.requestId) return callControls(roomId)
    const current = callControls(roomId)
    if (input.revision !== current.revision) throw new CallError('Los controles cambiaron. Actualice antes de preparar.', 409)
    db.run(`INSERT INTO karaokeCallControls(roomId,revision,preparing,setupRequestId,setupAttempt) VALUES(?,?,1,?,1)
      ON CONFLICT(roomId) DO UPDATE SET revision=excluded.revision,preparing=1,setupRequestId=excluded.setupRequestId,setupAttempt=setupAttempt+1`, [roomId, current.revision + 1, input.requestId])
    this.reconcile()
    return callControls(roomId)
  }

  retry (roomId: number, queueId: number, inputKey: unknown) {
    if (!callControls(roomId).preparing) throw new CallError('Active los llamados automáticos o prepare las mesas antes de reintentar.')
    const row = requestCall(roomId, queueId)
    const song = Queue.get(roomId).entities[queueId]
    if (!row || !this.eligible(roomId, song) || row.startedAt || inputKey !== row.inputKey) throw new CallError('El pedido cambió o ya comenzó.', 409)
    if (!['waiting', 'preparing'].includes(row.status)) db.run(`UPDATE karaokeCallRequests SET attempt=attempt+1,jobId=NULL,resultId=NULL,status='waiting',reason=NULL WHERE roomId=? AND queueId=?`, [roomId, queueId])
    this.reconcile()
  }

  async recover (roomId: number, queueId: number, input: { requestId?: unknown }) {
    const saved = requestCall(roomId, queueId)
    if (!saved) return this.listening.recover(roomId, queueId, input)
    const item = Queue.get(roomId).entities[queueId]
    if (!item || ['APPROVED', 'PLAYING'].includes(item.status) || !retainedSinging(roomId).some(row => row.queueId === queueId)) throw new CallError('El pedido no está disponible en el historial.', 404)
    const result = await this.worker.recover(roomId, saved.resultId ?? '', input.requestId)
    db.run('UPDATE karaokeCallRequests SET recoveryJobId=?,recoveredPartId=COALESCE(?,recoveredPartId) WHERE roomId=? AND queueId=?',
      [result.id, result.result?.id ?? null, roomId, queueId])
    return result
  }

  prioritize (roomId: number, queueId: number) {
    const item = Queue.get(roomId).entities[queueId]
    if (!item || item.status !== 'APPROVED') return
    this.next.set(roomId, queueId)
    this.listening.prioritize(roomId, item)
    if (!this.eligible(roomId, item)) return
    const row = requestCall(roomId, queueId)
    if (row?.jobId) db.run(`UPDATE karaokeCallJobs SET priority=100 WHERE id=? AND status='queued'`, [row.jobId])
  }

  private currentJob (row: JobRow) {
    if (!db.get('SELECT roomId FROM rooms WHERE roomId=?', [row.roomId])) return false
    // Pausing admission need not discard a provider response already in flight.
    // The worker checks enablement before dispatch; playback has its own gate.
    if (row.purpose !== 'automatic') return true
    const request = db.get<RequestRow>('SELECT * FROM karaokeCallRequests WHERE roomId=? AND jobId=?', [row.roomId, row.id])
    if (!request || request.startedAt) return false
    const item = Queue.get(row.roomId).entities[request.queueId]
    const intro = this.compatibleIntros(row.roomId).find(part => part.id === request.introId)
    return isSingingRequest(item) && item?.status === 'APPROVED' && !!intro && request.inputKey === this.inputKey(row.roomId, item, intro)
  }

  private admit (roomId: number, operation: Parameters<CallJobs['submit']>[1], identity: unknown[], body: Record<string, unknown>, tableId?: number, priority = 0) {
    const attempt = db.get<{ setupAttempt: number }>('SELECT setupAttempt FROM karaokeCallControls WHERE roomId=?', [roomId])?.setupAttempt ?? 0
    const requestId = `setup-${key([roomId, operation, identity, key(this.voice.profile()), attempt])}`
    const existing = db.get<JobRow>('SELECT * FROM karaokeCallJobs WHERE roomId=? AND requestId=?', [roomId, requestId])
    if (existing) return existing
    if (!this.voice.snapshot().config.enabled || !this.voice.snapshot().configured) return undefined
    try {
      const submitted = this.worker.submit(roomId, operation, { ...body, requestId }, tableId, 'setup', priority)
      return job(roomId, submitted.id)
    } catch (error) {
      if (error instanceof CallError && error.status === 409) return undefined
      throw error
    }
  }

  private fallback (roomId: number, intro: PartRow, tableId?: number) {
    const table = tableId === undefined ? null : tableVoice(roomId, tableId, this.voice.profile())
    if (table && (!table.part || table.outdated)) return
    const scope = tableId === undefined ? 'room' : `table-${tableId}`
    const inputKey = key([intro.id, table?.part?.id, table?.revision, key(this.voice.profile()), compositionRevision])
    const old = db.get<FallbackRow>('SELECT * FROM karaokeCallFallbacks WHERE roomId=? AND scope=?', [roomId, scope])
    if (old?.inputKey === inputKey && old.resultId && part(roomId, old.resultId)) return
    const result = this.admit(roomId, 'fallback', [inputKey], { introId: intro.id, ...(tableId === undefined ? {} : { tableId }) }, undefined, tableId === undefined ? 90 : 20)
    db.run(`INSERT INTO karaokeCallFallbacks(roomId,scope,inputKey,jobId,resultId) VALUES(?,?,?,?,?) ON CONFLICT(roomId,scope)
      DO UPDATE SET inputKey=excluded.inputKey,jobId=excluded.jobId,resultId=excluded.resultId`, [roomId, scope, inputKey, result?.id ?? null, result?.status === 'ready' ? result.resultId : null])
  }

  private reconcileRequest (roomId: number, item: QueueItem) {
    let row = requestCall(roomId, item.queueId)
    if (row?.startedAt) return
    const intro = this.chooseIntro(roomId, row)
    const inputKey = this.inputKey(roomId, item, intro)
    if (!row || row.inputKey !== inputKey) {
      if (row?.jobId && pending.has(job(roomId, row.jobId)?.status ?? '')) this.worker.cancel(roomId, row.jobId)
      db.run(`INSERT INTO karaokeCallRequests(queueId,roomId,inputKey,introId,updatedAt) VALUES(?,?,?,?,?) ON CONFLICT(queueId)
        DO UPDATE SET inputKey=excluded.inputKey,introId=excluded.introId,jobId=NULL,resultId=NULL,status='waiting',reason=NULL,attempt=0,updatedAt=excluded.updatedAt`,
      [item.queueId, roomId, inputKey, intro?.id ?? null, Date.now()])
      row = requestCall(roomId, item.queueId)!
    }
    const table = this.table(roomId, item)
    let reason: string | null = !intro ? 'Preparando una introducción compatible.' : !table?.part || table.outdated ? 'La mesa todavía no tiene una voz compatible con este pedido.' : null
    try {
      const continuation = callContinuation(item.userDisplayName, item.title)
      if ([...(intro?.text ?? ''), ...(table?.part?.text ?? ''), ...continuation].length + 2 > 220) reason = 'La presentación es muy larga. Se usará el llamado básico.'
    } catch { reason = 'El nombre o el título no permite una locución breve. Se usará el llamado básico.' }
    let current = row.jobId ? job(roomId, row.jobId) : undefined
    if (!reason && !current && this.voice.snapshot().config.enabled && this.voice.snapshot().configured) {
      try {
        const result = this.worker.submit(roomId, 'hybrid', { requestId: `request-${key([item.queueId, inputKey, row.attempt])}`,
          introId: intro!.id, tableId: item.tableId, performer: item.userDisplayName, song: item.title }, undefined, 'automatic', this.next.get(roomId) === item.queueId ? 100 : 50)
        db.run('UPDATE karaokeCallRequests SET jobId=? WHERE queueId=?', [result.id, item.queueId])
        current = job(roomId, result.id)
      } catch (error) {
        reason = error instanceof CallError && error.status === 409 ? 'Esperando espacio para preparar la voz.' : (error as Error).message
      }
    }
    const ready = current?.status === 'ready' && !jobOutdated(current, this.voice.profile()) && current.resultId && part(roomId, current.resultId)
    const status = ready ? 'ready' : current && pending.has(current.status) ? 'preparing' : current || reason ? 'fallback' : 'waiting'
    reason = ready ? null : current?.error ?? reason ?? 'Esperando la generación de voz habilitada.'
    const resultId = ready ? current!.resultId : null
    if (row.resultId !== resultId || row.status !== status || row.reason !== reason) {
      db.run('UPDATE karaokeCallRequests SET resultId=?,status=?,reason=?,updatedAt=? WHERE queueId=?', [resultId, status, reason, Date.now(), item.queueId])
    }
  }

  reconcile () {
    if (this.reconciling) return
    this.reconciling = true
    try {
      for (const { roomId } of db.all<{ roomId: number }>('SELECT roomId FROM karaokeCallControls UNION SELECT roomId FROM greetingControls WHERE audioEnabled=1')) {
        const controls = callControls(roomId)
        const queue = Queue.get(roomId)
        if (this.open(roomId)) this.listening.reconcile(roomId, queue.result.map(id => queue.entities[id])
          .sort((a, b) => Number(b.queueId === this.next.get(roomId)) - Number(a.queueId === this.next.get(roomId))))
        for (const request of db.all<RequestRow>(`SELECT * FROM karaokeCallRequests WHERE roomId=? AND startedAt IS NULL AND status!='cancelled'`, [roomId])) {
          const item = queue.entities[request.queueId]
          if (isSingingRequest(item) && item.status === 'APPROVED') continue
          if (request.jobId && pending.has(job(roomId, request.jobId)?.status ?? '')) this.worker.cancel(roomId, request.jobId)
          if (!request.startedAt) db.run(`UPDATE karaokeCallRequests SET status='cancelled',reason='El pedido ya no espera un llamado automático.' WHERE queueId=?`, [request.queueId])
        }
        if (!controls.preparing || !this.open(roomId)) continue
        const candidates = queue.result.map(id => queue.entities[id]).filter(item => this.eligible(roomId, item))
          .sort((a, b) => Number(b.queueId === this.next.get(roomId)) - Number(a.queueId === this.next.get(roomId)))
        let introductions = this.compatibleIntros(roomId)
        const savedIntros = intros(roomId).filter(item => !controls.introIds.length || controls.introIds.includes(item.variantId))
        for (const saved of savedIntros.filter(item => item.profileKey !== key(this.voice.profile()))) {
          this.admit(roomId, 'intro', [saved.variantId, saved.text, saved.title], { previousId: saved.id, title: saved.title, text: saved.text }, undefined, 90)
        }
        if (!savedIntros.length && !controls.introIds.length) {
          this.admit(roomId, 'intro', ['default-intro'], { title: 'Vamos con el karaoke', text: '¡Vamos con el karaoke!' }, undefined, 95)
          introductions = this.compatibleIntros(roomId)
        }
        const intro = introductions[0]
        if (intro) this.fallback(roomId, intro)
        for (const item of candidates) this.reconcileRequest(roomId, item)
        // Admit upcoming requests before completing the rest of the setup bank.
        const tables = Tables.list(roomId).filter(table => table.status === 'active')
          .sort((a, b) => Number(candidates[0]?.tableId === b.tableId) - Number(candidates[0]?.tableId === a.tableId))
        for (const table of tables) {
          const state = tableVoice(roomId, table.tableId, this.voice.profile())
          if (!state.part || state.outdated) {
            const saved = binding(roomId, table.tableId)
            const unfinished = db.get<JobRow>(`SELECT * FROM karaokeCallJobs WHERE roomId=? AND operation='table' AND json_extract(inputJSON,'$.tableId')=? AND status IN ('queued','generating','preparing')`, [roomId, table.tableId])
            if (!unfinished) {
              // Desired identity excludes binding revision: a failed job must not loop.
              this.admit(roomId, 'table', [table.tableId, table.code, state.spokenText], { text: state.spokenText, revision: saved?.revision ?? 0 }, table.tableId, candidates[0]?.tableId === table.tableId ? 90 : 10)
            }
          } else if (intro) this.fallback(roomId, intro, table.tableId)
        }
        for (const item of candidates) this.reconcileRequest(roomId, item)
      }
    } finally { this.reconciling = false }
  }

  private fallbackPart (roomId: number, scope: string) {
    const row = db.get<FallbackRow>('SELECT * FROM karaokeCallFallbacks WHERE roomId=? AND scope=?', [roomId, scope])
    const result = row?.resultId && part(roomId, row.resultId)
    const source = row?.jobId && job(roomId, row.jobId)
    return result && source && !jobOutdated(source, this.voice.profile()) ? result : undefined
  }

  preparation (roomId: number, queueId: number, allowStarted = false): CallPreparation | null {
    const controls = callControls(roomId)
    const item = Queue.get(roomId).entities[queueId]
    if (!item) return null
    const listening = this.listening.preparation(roomId, item, allowStarted)
    if (!controls.enabled || !this.eligible(roomId, item)) return listening
    const row = requestCall(roomId, queueId)
    const intro = this.compatibleIntros(roomId).find(candidate => candidate.id === row?.introId)
    const inputKey = this.inputKey(roomId, item, intro)
    const assets: CallAsset[] = []
    const add = (audio?: PartRow, identifiesSender = false) => {
      if (!audio || assets.some(asset => asset.partId === audio.id)) return
      assets.push({ id: `call-${audio.id}`, partId: audio.id, role: 'call', identifiesSender, title: audio.title, displayText: audio.text, kind: 'voice', family: 'turn',
        durationMs: audio.durationMs, checksum: audio.checksum, source: 'Gemini karaoke call', license: 'Generated with the configured provider.',
        url: `api/rooms/${roomId}/karaoke-calls/requests/${queueId}/audio/${audio.id}` })
    }
    if (!row?.startedAt || allowStarted) {
      if (row?.inputKey === inputKey && row.resultId && row.jobId) {
        const source = job(roomId, row.jobId)
        if (source && !jobOutdated(source, this.voice.profile())) add(part(roomId, row.resultId), true)
      }
      if (this.table(roomId, item)) add(this.fallbackPart(roomId, `table-${item.tableId}`))
      add(this.fallbackPart(roomId, 'room'))
    }
    assets.push(...(listening?.assets.filter(asset => asset.role === 'signature') ?? []))
    return { queueId, inputKey, revision: controls.revision, assets, signatureKey: listening?.signatureKey, reason: row?.reason ?? 'Preparando el llamado; la música continúa.' }
  }

  valid (roomId: number, context: CallContext, started = false) {
    if (context.kind) {
      const item = Queue.get(roomId).entities[context.queueId]
      return !!item && this.listening.valid(roomId, item, context, started)
    }
    const prepared = this.preparation(roomId, context.queueId, started)
    return !!prepared && prepared.inputKey === context.inputKey && prepared.revision === context.revision && prepared.assets.some(asset => asset.partId === context.partId)
  }

  started (roomId: number, context: CallContext) {
    if (context.kind) return this.listening.started(roomId, context.queueId)
    db.run('UPDATE karaokeCallRequests SET startedAt=COALESCE(startedAt,?) WHERE roomId=? AND queueId=?', [Date.now(), roomId, context.queueId])
  }

  async audio (roomId: number, queueId: number, id: string) {
    const authorized = () => this.preparation(roomId, queueId)?.assets.some(asset => asset.partId === id)
      || !!db.get(`SELECT 1 FROM animationInterventions WHERE roomId=? AND leaseUntil>? AND status IN ('RESERVED','PLAYING')
        AND json_extract(callJSON,'$.queueId')=? AND json_extract(callJSON,'$.partId')=?`, [roomId, Date.now(), queueId, id])
    if (!authorized()) throw new CallError('El audio ya no corresponde a este pedido.', 404)
    const bytes = await this.worker.bytes(roomId, id)
    if (!authorized()) throw new CallError('El pedido cambió durante la descarga.', 404)
    return bytes
  }

  snapshot (roomId: number, queueId?: number): CallAutomationSnapshot {
    const controls = callControls(roomId)
    const tables = Tables.list(roomId).filter(table => table.status === 'active')
    const queue = Queue.get(roomId)
    const voice = this.voice.snapshot()
    const room = db.get<{ data: string }>('SELECT data FROM rooms WHERE roomId=?', [roomId])!
    const prefs = animationPrefs(JSON.parse(room.data).prefs?.animation)
    const retained = new Set(retainedSinging(roomId).map(row => row.queueId))
    let message: string | null = null
    if (!this.open(roomId)) message = 'Abra la sala para preparar y reproducir llamados automáticos.'
    else if (!voice.config.enabled) message = 'Active la generación en Voz de saludos para preparar automáticamente. Los audios guardados siguen disponibles.'
    else if (!voice.configured || ['error', 'limited'].includes(voice.state)) message = voice.message
    else if ((controls.enabled || controls.listeningEnabled) && (!prefs.enabled || !prefs.automation || !prefs.events.turn)) message = 'Active el animador automático y las presentaciones en Control para escuchar los llamados.'
    else if ((controls.enabled || controls.listeningEnabled) && !callSessionAllows(roomId)) message = 'La jornada terminó. Inicie una nueva jornada en Control para escuchar los llamados.'
    if (!message) {
      const failure = db.all<JobRow>(`SELECT * FROM karaokeCallJobs WHERE roomId=? AND purpose='setup' AND status IN ('failed','uncertain') ORDER BY rowid DESC LIMIT 30`, [roomId]).find((row) => {
        if (key(JSON.parse(row.profileJSON)) !== key(this.voice.profile())) return false
        const input: JobInput = JSON.parse(row.inputJSON)
        if (row.operation === 'intro') return !this.compatibleIntros(roomId).length && (!controls.introIds.length || controls.introIds.includes(input.variantId))
        if (row.operation === 'fallback') return !!db.get('SELECT 1 FROM karaokeCallFallbacks WHERE roomId=? AND jobId=?', [roomId, row.id])
        const table = tables.find(table => table.tableId === input.tableId)
        return !!table && binding(roomId, table.tableId)?.revision === input.revision && tableVoice(roomId, table.tableId, this.voice.profile()).outdated
      })
      if (failure) message = `${JSON.parse(failure.inputJSON).title}: ${failure.error ?? 'No se pudo preparar la voz.'} Use Preparar mesas para reintentar.`
    }
    return { controls, tablesTotal: tables.length, tablesReady: tables.filter(table => !!this.fallbackPart(roomId, `table-${table.tableId}`)).length,
      fallbackReady: !!this.fallbackPart(roomId, 'room'), message,
      listeningRequests: this.listening.states(roomId, queue.result.map(id => queue.entities[id]).filter(item => queueId === undefined || item.queueId === queueId)).reverse(),
      listeningTemplates: this.listening.templates.list(roomId),
      requests: db.all<RequestRow>(`SELECT * FROM karaokeCallRequests WHERE roomId=?${queueId === undefined ? '' : ' AND queueId=?'} ORDER BY queueId DESC`, queueId === undefined ? [roomId] : [roomId, queueId]).flatMap((row) => {
        const item = queue.entities[row.queueId]
        if (!item || !retained.has(row.queueId)) return []
        const pending = ['APPROVED', 'PLAYING'].includes(item.status)
        const result = (row.recoveredPartId && part(roomId, row.recoveredPartId)) || (row.resultId && part(roomId, row.resultId))
        const compatible = !pending || row.inputKey === this.inputKey(roomId, item, this.compatibleIntros(roomId).find(intro => intro.id === row.introId))
        const original = row.jobId ? job(roomId, row.jobId) : undefined
        const saved = original ? JSON.parse(original.requestJSON) as { performer?: string, song?: string } : {}
        const recovery = row.recoveryJobId ? job(roomId, row.recoveryJobId) : undefined
        const intervention = db.get<{ status: string, reason: string | null, startedAt: number | null, partId: string }>(`SELECT status,reason,startedAt,json_extract(callJSON,'$.partId') partId
          FROM animationInterventions WHERE roomId=? AND json_extract(callJSON,'$.queueId')=? AND json_extract(callJSON,'$.kind') IS NULL ORDER BY requestedAt DESC LIMIT 1`, [roomId, row.queueId])
        const playback: CallRequestState['playback'] = intervention?.status === 'PLAYED'
          ? 'played'
          : intervention && ['RESERVED', 'PLAYING'].includes(intervention.status)
            ? 'playing'
            : intervention ? intervention.startedAt ? 'interrupted' : 'omitted' : !pending || row.playbackReason ? 'omitted' : 'pending'
        const played = intervention?.startedAt ? part(roomId, intervention.partId) : undefined
        const playbackReason = row.playbackReason
          ? callPlaybackReasons[row.playbackReason as keyof typeof callPlaybackReasons]
          : intervention?.reason ?? (playback === 'omitted' ? 'No se registró la reproducción de este llamado.' : null)
        return [{ queueId: row.queueId, inputKey: row.inputKey, title: !pending && saved.song ? saved.song : item.title,
          performer: !pending && saved.performer ? saved.performer : item.userDisplayName, tableLabel: item.tableLabelSnapshot ?? null,
          playback, playbackReason, playedResult: played ? partDTO(played) : null, usedFallback: !!played && played.id !== row.resultId,
          canRecover: !pending && !result && !!row.resultId,
          recoveryJob: recovery ? jobDTO(recovery, this.voice.profile()) : null,
          status: row.status === 'ready' && (!compatible || !result) && !row.startedAt ? 'fallback' as const : row.status,
          reason: !pending && !result ? played ? null : row.resultId ? 'El audio de este llamado fue retirado.' : 'No se generó un llamado para este pedido.' : row.reason,
          result: result && compatible ? partDTO(result) : null, startedAt: row.startedAt }]
      }) }
  }
}
