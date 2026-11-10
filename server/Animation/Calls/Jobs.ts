import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { db } from '../../lib/Database.js'
import Tables from '../../Tables/Tables.js'
import type GreetingVoice from '../../Greetings/GreetingVoice.js'
import { GreetingVoiceError } from '../../Greetings/GeminiGreetingTts.js'
import { callSpeechProfile, nameVoiceRecipeRevision, type GreetingVoiceProfile } from '../../Greetings/voiceProfile.js'
import { AudioValidationError } from '../AudioPreparation.js'
import { callContinuation, callText, type CallJobPurpose, type CallOperation, type CallPurpose, type CallSnapshot } from '../../../shared/karaokeCalls.js'
import { binding, intros, job, jobDTO, jobOutdated, key, part, partDTO, retainedListening, retainedSinging, tableVoice, type JobInput, type JobRow, type PartRow } from './Store.js'
import { checksum, compose, compositionRevision, preparedPart } from './Composition.js'
import getLogger from '../../lib/Log.js'
import NameBank, { NameVoiceError, type NameMetadata } from './NameBank.js'
import { getNameVoiceStyle } from './nameStyle.js'

const active = '(\'queued\',\'generating\',\'preparing\')'
export class CallError extends Error {
  constructor (message: string, readonly status = 422) { super(message) }
}
type Voice = Pick<GreetingVoice, 'profile' | 'snapshot' | 'generate'>

export default class CallJobs {
  private timer?: ReturnType<typeof setInterval>
  private running: Promise<void> | null = null
  private controller?: AbortController
  private runningId: string | null = null
  private stopped = false
  private startupError: string | null = null
  validateAutomatic?: (row: JobRow) => boolean
  constructor (private directory: string, private tts: Voice, private ffmpeg = 'ffmpeg') {}

  async start () {
    NameBank.initialize()
    db.run(`UPDATE karaokeCallJobs SET status='uncertain',error='La preparación se interrumpió. Revise antes de generar de nuevo.',updatedAt=? WHERE status IN ('generating','preparing')`, [Date.now()])
    try {
      await fs.mkdir(this.directory, { recursive: true })
      // No work survives process shutdown; only abandoned scratch directories are removed.
      for (const name of await fs.readdir(this.directory)) {
        if (/^\.compose-|^[a-f0-9-]+\.input$/.test(name)) await fs.rm(path.join(this.directory, name), { recursive: true, force: true })
      }
      const stored = db.all<PartRow>('SELECT * FROM karaokeCallParts WHERE retired=0')
      const retainedFiles = new Set(stored.flatMap(row => [row.master, row.filename]))
      for (const folder of ['masters', 'production']) {
        for (const name of await fs.readdir(path.join(this.directory, folder)).catch((): string[] => [])) {
          const relative = `${folder}/${name}`
          if (/^[a-f0-9-]+\.(wav|mp3|part|download)$/.test(name) && !retainedFiles.has(relative)) await fs.rm(path.join(this.directory, relative), { force: true })
        }
      }
      this.timer = setInterval(() => {
        void this.tick()
      }, 500)
      this.timer.unref()
    } catch {
      this.startupError = 'No se pudo preparar el almacenamiento de llamados. Revise el servidor.'
    }
  }

  snapshot (roomId: number): CallSnapshot {
    Tables.room(roomId)
    const profile = this.tts.profile()
    return { intros: intros(roomId).map(partDTO), profileKey: key(profile), voice: this.tts.snapshot(), error: this.startupError,
      names: db.all<PartRow>(`SELECT * FROM karaokeCallParts WHERE kind='name' AND retired=0 ORDER BY text,createdAt DESC`).map(partDTO),
      jobs: db.all<JobRow>(`SELECT * FROM karaokeCallJobs WHERE roomId=? AND purpose='preview'
        AND NOT (operation='source' AND json_extract(inputJSON,'$.sourceKind')='template') ORDER BY rowid DESC LIMIT 20`, [roomId]).map(row => jobDTO(row, profile)),
      tables: Tables.list(roomId).filter(table => table.status === 'active').map(table => tableVoice(roomId, table.tableId, profile)) }
  }

  submit (roomId: number, operation: CallOperation, value: unknown, tableId?: number, purpose: CallJobPurpose = 'preview', priority = 0, historicalProfile?: GreetingVoiceProfile) {
    Tables.room(roomId)
    if (historicalProfile && (operation !== 'compose' || purpose !== 'preview')) throw new CallError('La recuperación histórica solo permite composición privada.')
    if (this.stopped || this.startupError) throw new CallError(this.startupError ?? 'El servidor se está cerrando.', 503)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CallError('Datos de preparación no válidos.')
    const body = value as Record<string, unknown>
    if (typeof body.requestId !== 'string' || !/^[\w-]{8,100}$/.test(body.requestId)) throw new CallError('La solicitud necesita un identificador válido.')
    const name = operation === 'source' && body.sourceKind === 'name'
      ? typeof body.nameId === 'string' ? NameBank.get(body.nameId) : NameBank.ensure(callText(body.text, 24))
      : undefined
    if (name?.archived) throw new CallError('Reactive la pronunciación antes de generar audio.')
    const requestJSON = JSON.stringify({ operation, tableId, text: body.text, title: body.title, previousId: body.previousId,
      revision: body.revision, introId: body.introId, table: body.tableId, performer: body.performer, song: body.song,
      sourceKind: body.sourceKind, sourceIds: body.sourceIds, regenerate: body.regenerate === true, nameId: name?.id, reprocessPartId: body.reprocessPartId })
    const receipt = name
      ? db.get<JobRow>(`SELECT * FROM karaokeCallJobs WHERE requestId=? AND operation='source' AND json_extract(inputJSON,'$.nameId') IS NOT NULL`, [body.requestId])
      : db.get<JobRow>('SELECT * FROM karaokeCallJobs WHERE roomId=? AND requestId=?', [roomId, body.requestId])
    if (receipt) {
      if (receipt.requestJSON !== requestJSON || receipt.purpose !== purpose) throw new CallError('El identificador pertenece a otra preparación.', 409)
      return jobDTO(receipt, this.tts.profile())
    }
    // Leave one slot for an explicit private operation even when automation is paused.
    if (db.get<{ n: number }>(`SELECT count(*) n FROM karaokeCallJobs WHERE status IN ${active}`)!.n >= (purpose === 'preview' ? 10 : 9)) throw new CallError('La cola de preparación está ocupada. Espere o cancele una.', 409)
    const profile = historicalProfile ?? this.tts.profile()
    const input: JobInput = { title: '', text: '', variantId: randomUUID(), regenerate: body.regenerate === true }
    if (operation === 'source') {
      if (!['name', 'template', 'signature'].includes(String(body.sourceKind))) throw new CallError('Tipo de voz no válido.')
      input.sourceKind = body.sourceKind as JobInput['sourceKind']
      input.text = callText(body.text, 100)
      input.title = input.text
      if (name) {
        input.nameId = name.id
        input.nameBankRevision = 1
        const settings = getNameVoiceStyle(profile)
        input.nameStyle = settings.style
        input.nameModel = settings.model
        input.nameRecipeRevision = nameVoiceRecipeRevision
        if (body.reprocessPartId !== undefined) {
          const original = typeof body.reprocessPartId === 'string' ? part(roomId, body.reprocessPartId) : undefined
          if (!original || original.kind !== 'name' || original.nameId !== name.id || !NameBank.compatible(original, profile)) throw new CallError('Seleccione una versión disponible de la voz actual.')
          input.nameReprocessId = original.id
          input.text = original.text
          input.title = original.text
          input.regenerate = true
          input.nameStyle = NameBank.info(original).style
          input.nameModel = NameBank.info(original).profile?.model as JobInput['nameModel']
          input.nameRecipeRevision = NameBank.info(original).recipeRevision
        } else if (input.text !== name.spokenText) throw new CallError('La pronunciación cambió. Actualice sus datos antes de generar.')
      }
    } else if (operation === 'compose') {
      if (historicalProfile && purpose === 'preview') input.historical = true
      if (body.sourceKind === 'signature') input.sourceKind = 'signature'
      if (!Array.isArray(body.sourceIds) || body.sourceIds.length < 2 || body.sourceIds.length > 3) throw new CallError('La presentación necesita dos o tres piezas.')
      const sources = body.sourceIds.map(id => typeof id === 'string' ? part(roomId, id) : undefined)
      if (sources.some(source => !source || (source.kind === 'name' ? !NameBank.compatible(source, profile) : source.profileKey !== key(profile)))) throw new CallError('Una pieza cambió o no está disponible.')
      input.sourceIds = sources.map(source => source!.id)
      input.text = callText(sources.map(source => source!.text).join(' '))
      input.title = input.text
    } else if (operation === 'intro') {
      input.text = callText(body.text, 100)
      input.title = callText(body.title, 80)
      if (body.previousId !== undefined) {
        const previous = typeof body.previousId === 'string' ? part(roomId, body.previousId) : undefined
        if (!previous || previous.kind !== 'intro' || !intros(roomId).some(item => item.id === previous.id)) throw new CallError('La introducción cambió. Actualice la lista.', 409)
        input.variantId = previous.variantId
      } else if (!input.regenerate) {
        const existing = intros(roomId).find(item => item.title === input.title && item.text === input.text && item.profileKey === key(profile))
        if (existing) input.variantId = existing.variantId
      }
    } else if (operation === 'table') {
      const table = Tables.get(roomId, tableId!)
      if (table.status !== 'active') throw new CallError('Seleccione una mesa activa.')
      const saved = binding(roomId, table.tableId)
      if (!Number.isSafeInteger(body.revision) || body.revision !== (saved?.revision ?? 0)) throw new CallError('La voz de la mesa cambió. Actualice antes de generar.', 409)
      Object.assign(input, { title: `Voz de mesa ${table.code}`, text: callText(body.text, 100), tableId: table.tableId,
        code: table.code, revision: (saved?.revision ?? 0) + 1, variantId: `table-${table.tableId}` })
    } else if (operation === 'fallback') {
      const intro = intros(roomId).find(item => item.id === body.introId && item.profileKey === key(profile))
      if (!intro) throw new CallError('Prepare una introducción con la voz actual.')
      const table = body.tableId === undefined ? undefined : Tables.get(roomId, Number(body.tableId))
      const voice = table && tableVoice(roomId, table.tableId, profile)
      if (table && (table.status !== 'active' || !voice?.part || voice.outdated)) throw new CallError('Prepare la voz de la mesa.')
      const continuation = table ? 'recibamos a nuestro próximo cantante. ¡Un aplauso!' : '¡Es momento de cantar!'
      Object.assign(input, { title: table ? `Llamado básico · Mesa ${table.code}` : 'Llamado básico de karaoke', introId: intro.id,
        ...(table ? { tableId: table.tableId, code: table.code, revision: voice!.revision, tablePartId: voice!.part!.id } : {}),
        continuation, text: callText([intro.text, voice?.part?.text, continuation].filter(Boolean).join(' ')) })
    } else {
      if (!Number.isSafeInteger(body.tableId) || typeof body.introId !== 'string') throw new CallError('Seleccione introducción y mesa.')
      const table = Tables.get(roomId, body.tableId as number)
      const tableAudio = tableVoice(roomId, table.tableId, profile)
      const intro = intros(roomId).find(item => item.id === body.introId && item.profileKey === key(profile))
      if (table.status !== 'active' || !tableAudio.part || tableAudio.outdated || !intro) throw new CallError('Prepare una introducción y una mesa con el perfil de voz actual.')
      const continuation = callContinuation(body.performer, body.song)
      Object.assign(input, { title: `${callText(body.performer, 60)} · Mesa ${table.code}`, tableId: table.tableId, code: table.code,
        revision: tableAudio.revision, tablePartId: tableAudio.part.id, introId: intro.id, continuation,
        text: callText(`${intro.text} ${tableAudio.part.text} ${continuation}`) })
    }
    const id = randomUUID()
    const now = Date.now()
    db.exec('SAVEPOINT call_submit')
    try {
      if (operation === 'table') db.run(`INSERT INTO tableCallVoices(tableId,roomId,spokenText,codeSnapshot,revision) VALUES(?,?,?,?,?)
        ON CONFLICT(tableId) DO UPDATE SET spokenText=excluded.spokenText,codeSnapshot=excluded.codeSnapshot,revision=excluded.revision`,
      [input.tableId, roomId, input.text, input.code, input.revision])
      db.run(`INSERT INTO karaokeCallJobs(id,roomId,requestId,operation,requestJSON,inputJSON,profileJSON,text,createdAt,updatedAt,purpose,priority) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id, roomId, body.requestId, operation, requestJSON, JSON.stringify(input), JSON.stringify(profile), input.text, now, now, purpose, priority])
      db.exec('RELEASE call_submit')
    } catch (error) {
      db.exec('ROLLBACK TO call_submit; RELEASE call_submit')
      throw error
    }
    // Automatic bindings must be committed before their worker can validate them.
    if (purpose === 'preview') void this.tick()
    return jobDTO(job(roomId, id)!, profile)
  }

  cancel (roomId: number, id: string) {
    const row = job(roomId, id)
    if (!row) throw new CallError('No se encontró la preparación.', 404)
    db.run(`UPDATE karaokeCallJobs SET status='cancelled',error='Cancelado por el operador.',updatedAt=? WHERE roomId=? AND id=? AND status IN ${active}`, [Date.now(), roomId, id])
    if (this.runningId === id) this.controller?.abort()
    return jobDTO(job(roomId, id)!, this.tts.profile())
  }

  private assertCurrent (row: JobRow) {
    const current = job(row.roomId, row.id)
    if (this.stopped || current?.status === 'cancelled') throw new CallError('Preparación cancelada.')
    if (row.purpose !== 'preview' && this.validateAutomatic && !this.validateAutomatic(row)) throw new CallError('La preparación automática ya no corresponde al pedido o a la sala.')
    if (jobOutdated(row, this.tts.profile())) throw new CallError('Los datos o el perfil cambiaron. Prepare una nueva versión.')
    if (row.operation === 'intro') {
      const input: JobInput = JSON.parse(row.inputJSON)
      const newer = db.get(`SELECT 1 FROM karaokeCallJobs WHERE roomId=? AND operation='intro' AND json_extract(inputJSON,'$.variantId')=? AND rowid>(SELECT rowid FROM karaokeCallJobs WHERE id=?) AND status!='cancelled'`, [row.roomId, input.variantId, row.id])
      if (newer) throw new CallError('Hay una versión más reciente de esta introducción.')
    }
  }

  tick (): Promise<void> {
    if (this.running) return this.running
    if (this.stopped || this.startupError) return Promise.resolve()
    const row = db.get<JobRow>(`SELECT * FROM karaokeCallJobs j WHERE status='queued' AND retryAt<=? AND
      (purpose='preview' OR (?=1 AND operation='source' AND json_extract(inputJSON,'$.nameId') IS NOT NULL) OR ((?=1 OR operation='compose') AND EXISTS(SELECT 1 FROM rooms r LEFT JOIN karaokeCallControls c USING(roomId) WHERE r.roomId=j.roomId AND r.status='open'
        AND (c.preparing=1 OR c.listeningEnabled=1 OR EXISTS(SELECT 1 FROM greetingControls g WHERE g.roomId=r.roomId AND g.audioEnabled=1 AND g.paused=0 AND json_extract(g.playbackJSON,'$.enabled')=1)))))
      ORDER BY priority DESC,rowid LIMIT 1`, [Date.now(), this.tts.snapshot().config.enabled ? 1 : 0, this.tts.snapshot().config.enabled ? 1 : 0])
    if (!row) return Promise.resolve()
    this.runningId = row.id
    this.controller = new AbortController()
    this.running = this.process(row).catch(() => {
      db.run(`UPDATE karaokeCallJobs SET status='failed',error='No se pudo completar la preparación.',updatedAt=? WHERE id=? AND status IN ${active}`, [Date.now(), row.id])
    }).finally(() => {
      this.running = null
      this.runningId = null
      this.controller = undefined
    })
    return this.running
  }

  private async storePart (row: JobRow, kind: PartRow['kind'], text: string, cacheKey: string, output: Awaited<ReturnType<typeof preparedPart>>, dependencies: string[] = []) {
    try {
      this.assertCurrent(row)
      const input: JobInput = JSON.parse(row.inputJSON)
      const profile: GreetingVoiceProfile = JSON.parse(row.profileJSON)
      if (kind === 'name' && input.nameModel) profile.model = input.nameModel
      const name = kind === 'name' && input.nameId ? NameBank.get(input.nameId) : undefined
      const selected = name && row.purpose !== 'preview' && !name.archived && !NameBank.selectedFor(name.id, profile)
      const metadata: NameMetadata | null = name
        ? { profile, style: input.nameStyle ?? null, recipeRevision: input.nameRecipeRevision ?? null,
            legacy: false, ...(input.nameReprocessId ? { reprocessedFrom: input.nameReprocessId } : {}) }
        : null
      db.run(`INSERT INTO karaokeCallParts(id,roomId,kind,variantId,title,text,profileKey,cacheKey,master,filename,checksum,masterChecksum,durationMs,dependenciesJSON,createdAt,nameId,nameSelected,nameMetadataJSON)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [output.id, name ? null : row.roomId, kind, input.variantId, input.title, text,
        key(profile), cacheKey, output.master, output.filename, output.checksum, output.masterChecksum, output.durationMs, JSON.stringify(dependencies), Date.now(), name?.id ?? null, selected ? 1 : 0, metadata ? JSON.stringify(metadata) : null])
      return part(row.roomId, output.id)!
    } catch (error) {
      await Promise.all([output.master, output.filename].map(file => fs.rm(path.join(this.directory, file), { force: true })))
      throw error
    }
  }

  private async generatePart (row: JobRow, purpose: CallPurpose, text: string) {
    const input: JobInput = JSON.parse(row.inputJSON)
    const profile: GreetingVoiceProfile = JSON.parse(row.profileJSON)
    const effectiveProfile = callSpeechProfile(profile, purpose)
    if (purpose === 'name') {
      effectiveProfile.style = input.nameStyle ?? getNameVoiceStyle(profile).style
      effectiveProfile.model = input.nameModel ?? profile.model
    }
    const cacheKey = key([purpose, text, effectiveProfile, compositionRevision, ['intro', 'table'].includes(purpose) ? input.variantId : null])
    const cached = !input.regenerate && (purpose === 'name' && input.nameId
      ? NameBank.selectedFor(input.nameId, profile)
      : db.get<PartRow>('SELECT * FROM karaokeCallParts WHERE roomId=? AND cacheKey=? AND retired=0 ORDER BY rowid DESC LIMIT 1', [row.roomId, cacheKey]))
    if (cached) {
      await this.bytes(row.roomId, cached.id, true)
      await this.bytes(row.roomId, cached.id)
      return cached
    }
    if (purpose === 'name' && !input.nameReprocessId && !input.nameStyle) {
      input.nameStyle = effectiveProfile.style
      input.nameRecipeRevision = nameVoiceRecipeRevision
      row.inputJSON = JSON.stringify(input)
      db.run('UPDATE karaokeCallJobs SET inputJSON=? WHERE id=?', [row.inputJSON, row.id])
    }
    this.assertCurrent(row)
    db.run('UPDATE karaokeCallJobs SET status=?,error=NULL,updatedAt=? WHERE id=?', [input.nameReprocessId ? 'preparing' : 'generating', Date.now(), row.id])
    const started = Date.now()
    let bytes: Buffer
    try {
      bytes = input.nameReprocessId
        ? await this.bytes(row.roomId, input.nameReprocessId, true)
        : await this.tts.generate(text, profile, this.controller!.signal, row.purpose === 'preview', purpose, input.nameStyle ?? undefined, input.nameModel)
    } finally {
      if (!input.nameReprocessId) db.run('UPDATE karaokeCallJobs SET providerMs=providerMs+? WHERE id=?', [Date.now() - started, row.id])
    }
    this.assertCurrent(row)
    db.run('UPDATE karaokeCallJobs SET status=\'preparing\',updatedAt=? WHERE id=?', [Date.now(), row.id])
    const preparation = Date.now()
    try {
      return await this.storePart(row, purpose, text, cacheKey, await preparedPart(this.directory, bytes, this.ffmpeg, this.controller!.signal))
    } finally {
      db.run('UPDATE karaokeCallJobs SET preparationMs=preparationMs+? WHERE id=?', [Date.now() - preparation, row.id])
    }
  }

  private async process (row: JobRow) {
    try {
      this.assertCurrent(row)
      const input: JobInput = JSON.parse(row.inputJSON)
      let result: PartRow
      if (row.operation === 'compose') {
        const pieces = input.sourceIds!.map(id => part(row.roomId, id))
        if (pieces.some(piece => !piece)) throw new CallError('Una pieza ya no está disponible.')
        const cacheKey = key([pieces.map(piece => [piece!.masterChecksum, piece!.text, piece!.profileKey]), compositionRevision])
        let cached = db.get<PartRow>('SELECT * FROM karaokeCallParts WHERE roomId=? AND cacheKey=? AND retired=0', [row.roomId, cacheKey])
        if (cached && input.historical) {
          try {
            await this.bytes(row.roomId, cached.id, true)
            await this.bytes(row.roomId, cached.id)
          } catch {
            db.run('UPDATE karaokeCallParts SET retired=1 WHERE id=?', [cached.id])
            cached = undefined
          }
        }
        result = cached ?? await this.storePart(row, input.sourceKind === 'signature' ? 'signature' : 'composition', input.text, cacheKey,
          await compose(this.directory, await Promise.all(pieces.map(piece => this.bytes(row.roomId, piece!.id, true))), this.ffmpeg, this.controller!.signal), input.sourceIds)
      } else if (row.operation === 'source') {
        result = await this.generatePart(row, input.sourceKind!, input.text)
      } else if (row.operation === 'hybrid' || row.operation === 'fallback') {
        const intro = part(row.roomId, input.introId!)
        const table = input.tablePartId ? part(row.roomId, input.tablePartId) : undefined
        if (!intro || (input.tablePartId && !table)) throw new CallError('Una pieza ya no está disponible.')
        const continuation = await this.generatePart(row, 'continuation', input.continuation!)
        this.assertCurrent(row)
        const pieces = [intro, ...(table ? [table] : []), continuation]
        const cacheKey = key([pieces.map(piece => [piece.masterChecksum, piece.text, piece.profileKey]), compositionRevision])
        const cached = db.get<PartRow>('SELECT * FROM karaokeCallParts WHERE roomId=? AND kind=\'composition\' AND cacheKey=? AND retired=0 ORDER BY rowid DESC LIMIT 1', [row.roomId, cacheKey])
        if (cached) {
          await this.bytes(row.roomId, cached.id)
          result = cached
        } else {
          db.run('UPDATE karaokeCallJobs SET status=\'preparing\',updatedAt=? WHERE id=?', [Date.now(), row.id])
          const started = Date.now()
          try {
            result = await this.storePart(row, 'composition', input.text, cacheKey,
              await compose(this.directory, await Promise.all(pieces.map(piece => this.bytes(row.roomId, piece.id, true))), this.ffmpeg, this.controller!.signal), pieces.map(piece => piece.id))
          } finally { db.run('UPDATE karaokeCallJobs SET preparationMs=preparationMs+? WHERE id=?', [Date.now() - started, row.id]) }
        }
      } else result = await this.generatePart(row, row.operation, input.text)
      this.assertCurrent(row)
      db.exec('SAVEPOINT call_ready')
      try {
        if (row.operation === 'table') {
          const changed = db.run('UPDATE tableCallVoices SET partId=? WHERE roomId=? AND tableId=? AND revision=? AND codeSnapshot=?', [result.id, row.roomId, input.tableId, input.revision, input.code])
          if (!changed.changes) throw new CallError('La mesa cambió durante la preparación.')
        }
        db.run('UPDATE karaokeCallJobs SET status=\'ready\',resultId=?,error=NULL,updatedAt=? WHERE id=?', [result.id, Date.now(), row.id])
        db.run('UPDATE listeningPresentations SET resultId=? WHERE roomId=? AND recoveryJobId=?', [result.id, row.roomId, row.id])
        db.run('UPDATE karaokeCallRequests SET recoveredPartId=? WHERE roomId=? AND recoveryJobId=?', [result.id, row.roomId, row.id])
        db.exec('RELEASE call_ready')
      } catch (error) {
        db.exec('ROLLBACK TO call_ready; RELEASE call_ready')
        throw error
      }
    } catch (error) {
      if (job(row.roomId, row.id)?.status !== 'cancelled') {
        if (!this.stopped && error instanceof GreetingVoiceError && ['busy', 'rate', 'quota', 'disabled'].includes(error.kind) && !error.attempted && (row.purpose !== 'preview' || error.kind !== 'disabled')) {
          db.run('UPDATE karaokeCallJobs SET status=\'queued\',retryAt=?,error=?,updatedAt=? WHERE id=?', [Math.max(Date.now() + 1000, error.retryAt), error.message, Date.now(), row.id])
        } else {
          const uncertain = this.stopped || (error instanceof GreetingVoiceError && error.kind === 'uncertain')
          const known = error instanceof CallError || error instanceof AudioValidationError || error instanceof GreetingVoiceError || error instanceof NameVoiceError
          if (!known) getLogger('calls').warn('Preparation %s (%s) failed: %s', row.id, row.operation, error instanceof Error ? error.stack ?? error.message : String(error))
          const message = known ? error.message : 'No se pudo preparar el audio. Revise el registro del servidor.'
          db.run('UPDATE karaokeCallJobs SET status=?,error=?,updatedAt=? WHERE id=?', [uncertain ? 'uncertain' : 'failed', message, Date.now(), row.id])
        }
      }
    }
    if (!this.stopped) await this.cleanup()
  }

  async bytes (roomId: number, id: string, master = false) {
    const audio = part(roomId, id)
    if (!audio) throw new CallError('El audio ya no está disponible.', 404)
    const filename = master ? audio.master : audio.filename
    if (!/^(masters\/[a-f0-9-]+\.wav|production\/[a-f0-9-]+\.mp3)$/.test(filename)) throw new CallError('Archivo de audio no válido.')
    const bytes = await fs.readFile(path.join(this.directory, filename)).catch(() => {
      throw new CallError('Falta el archivo. Regénere el audio.', 404)
    })
    if (checksum(bytes) !== (master ? audio.masterChecksum : audio.checksum)) throw new CallError('El archivo cambió. Regénere el audio.')
    return bytes
  }

  async recover (roomId: number, id: string, requestId: unknown) {
    const original = db.get<PartRow>('SELECT * FROM karaokeCallParts WHERE roomId=? AND id=?', [roomId, id])
    if (!original) throw new CallError('No se conservó la composición original de este pedido.')
    const sources = JSON.parse(original.dependenciesJSON) as string[]
    if (sources.length < 2 || sources.length > 3) throw new CallError('No se conservaron las piezas originales de este pedido.')
    await Promise.all(sources.map(id => this.bytes(roomId, id, true))).catch(() => {
      throw new CallError('No se conservan los archivos necesarios para recuperar este audio.')
    })
    const profile = db.all<{ profileJSON: string }>('SELECT DISTINCT profileJSON FROM karaokeCallJobs WHERE roomId=?', [roomId])
      .map(row => JSON.parse(row.profileJSON) as GreetingVoiceProfile).find(profile => key(profile) === original.profileKey)
    if (!profile) throw new CallError('No se conservó el perfil original de este audio.')
    return this.submit(roomId, 'compose', { requestId, sourceIds: sources }, undefined, 'preview', 0, profile)
  }

  private async cleanup () {
    const keep = new Set<string>()
    for (const { roomId } of db.all<{ roomId: number }>('SELECT DISTINCT roomId FROM karaokeCallParts WHERE roomId IS NOT NULL')) {
      for (const item of intros(roomId)) keep.add(item.id)
      for (const row of db.all<{ partId: string }>('SELECT partId FROM tableCallVoices WHERE roomId=? AND partId IS NOT NULL', [roomId])) keep.add(row.partId)
      const recent = db.all<JobRow>(`SELECT * FROM karaokeCallJobs WHERE roomId=? AND purpose='preview' AND operation IN ('hybrid','reference') AND status='ready' ORDER BY rowid DESC LIMIT 10`, [roomId])
      for (const row of [...recent, ...db.all<JobRow>(`SELECT * FROM karaokeCallJobs WHERE roomId=? AND status IN ${active}`, [roomId])]) {
        if (row.resultId) keep.add(row.resultId)
        const input: JobInput = JSON.parse(row.inputJSON)
        if (input.introId) keep.add(input.introId)
        if (input.tablePartId) keep.add(input.tablePartId)
        for (const id of input.sourceIds ?? []) keep.add(id)
      }
      for (const row of db.all<{ resultId: string | null, introId: string | null }>(`SELECT r.resultId,r.introId FROM karaokeCallRequests r JOIN queue q USING(queueId)
        WHERE r.roomId=? AND q.status IN ('APPROVED','PLAYING') UNION ALL SELECT resultId,NULL FROM karaokeCallFallbacks WHERE roomId=?`, [roomId, roomId])) {
        if (row.resultId) keep.add(row.resultId)
        if (row.introId) keep.add(row.introId)
      }
      // Keep completed work until reconciliation publishes its request binding.
      for (const row of db.all<{ resultId: string | null }>(`SELECT j.resultId FROM karaokeCallJobs j WHERE j.roomId=? AND j.status='ready' AND
        (EXISTS(SELECT 1 FROM karaokeCallRequests r JOIN queue q USING(queueId) WHERE r.jobId=j.id AND q.status IN ('APPROVED','PLAYING'))
        OR EXISTS(SELECT 1 FROM karaokeCallFallbacks f WHERE f.jobId=j.id))`, [roomId])) if (row.resultId) keep.add(row.resultId)
      for (const row of db.all<{ callJSON: string }>('SELECT callJSON FROM animationInterventions WHERE roomId=? AND callJSON IS NOT NULL AND leaseUntil>?', [roomId, Date.now()])) {
        try {
          keep.add(JSON.parse(row.callJSON).partId)
        } catch { /* Invalid metadata cannot retain arbitrary files. */ }
      }
    }
    const rows = db.all<PartRow>('SELECT * FROM karaokeCallParts WHERE retired=0')
    for (const row of rows) if (['name', 'template', 'signature'].includes(row.kind)) keep.add(row.id)
    for (const { roomId } of db.all<{ roomId: number }>('SELECT DISTINCT roomId FROM listeningPresentations')) {
      for (const row of retainedListening(roomId)) {
        if (row.resultId) keep.add(row.resultId)
        if (row.signatureId) keep.add(row.signatureId)
      }
    }
    for (const { roomId } of db.all<{ roomId: number }>('SELECT DISTINCT roomId FROM karaokeCallRequests')) {
      for (const row of retainedSinging(roomId)) {
        if (row.resultId) keep.add(row.resultId)
        if (row.recoveredPartId) keep.add(row.recoveredPartId)
        for (const actual of db.all<{ partId: string }>(`SELECT json_extract(callJSON,'$.partId') partId FROM animationInterventions
          WHERE roomId=? AND json_extract(callJSON,'$.queueId')=? AND startedAt IS NOT NULL`, [roomId, row.queueId])) keep.add(actual.partId)
      }
    }
    // Keep freshly completed compositions until server reconciliation binds them.
    for (const row of db.all<{ resultId: string }>(`SELECT resultId FROM karaokeCallJobs WHERE operation='compose' AND status='ready' AND updatedAt>?`, [Date.now() - 5000])) keep.add(row.resultId)
    // Composition dependency graphs are acyclic and only contain immutable older parts.
    for (let count = -1; count !== keep.size;) {
      count = keep.size
      for (const row of rows) if (keep.has(row.id)) for (const id of JSON.parse(row.dependenciesJSON) as string[]) keep.add(id)
    }
    for (const row of rows) if (!keep.has(row.id)) {
      db.run('UPDATE karaokeCallParts SET retired=1 WHERE id=?', [row.id])
      await Promise.all([row.master, row.filename].map(file => fs.rm(path.join(this.directory, file), { force: true })))
    }
  }

  async stop () {
    this.stopped = true
    clearInterval(this.timer)
    this.controller?.abort()
    await this.running
  }
}
