import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { db } from '../../lib/Database.js'
import Tables from '../../Tables/Tables.js'
import type GreetingVoice from '../../Greetings/GreetingVoice.js'
import { GreetingVoiceError } from '../../Greetings/GeminiGreetingTts.js'
import { callSpeechProfile, type GreetingVoiceProfile } from '../../Greetings/voiceProfile.js'
import { AudioValidationError } from '../AudioPreparation.js'
import { callContinuation, callText, type CallOperation, type CallPurpose, type CallSnapshot } from '../../../shared/karaokeCalls.js'
import { binding, intros, job, jobDTO, jobOutdated, key, part, partDTO, tableVoice, type JobInput, type JobRow, type PartRow } from './Store.js'
import { checksum, compose, compositionRevision, preparedPart } from './Composition.js'

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
  constructor (private directory: string, private tts: Voice, private ffmpeg = 'ffmpeg') {}

  async start () {
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
      jobs: db.all<JobRow>('SELECT * FROM karaokeCallJobs WHERE roomId=? ORDER BY rowid DESC LIMIT 20', [roomId]).map(row => jobDTO(row, profile)),
      tables: Tables.list(roomId).filter(table => table.status === 'active').map(table => tableVoice(roomId, table.tableId, profile)) }
  }

  submit (roomId: number, operation: CallOperation, value: unknown, tableId?: number) {
    Tables.room(roomId)
    if (this.stopped || this.startupError) throw new CallError(this.startupError ?? 'El servidor se está cerrando.', 503)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CallError('Datos de preparación no válidos.')
    const body = value as Record<string, unknown>
    if (typeof body.requestId !== 'string' || !/^[\w-]{8,100}$/.test(body.requestId)) throw new CallError('La solicitud necesita un identificador válido.')
    const requestJSON = JSON.stringify({ operation, tableId, text: body.text, title: body.title, previousId: body.previousId,
      revision: body.revision, introId: body.introId, table: body.tableId, performer: body.performer, song: body.song, regenerate: body.regenerate === true })
    const receipt = db.get<JobRow>('SELECT * FROM karaokeCallJobs WHERE roomId=? AND requestId=?', [roomId, body.requestId])
    if (receipt) {
      if (receipt.requestJSON !== requestJSON) throw new CallError('El identificador pertenece a otra preparación.', 409)
      return jobDTO(receipt, this.tts.profile())
    }
    if (db.get<{ n: number }>(`SELECT count(*) n FROM karaokeCallJobs WHERE status IN ${active}`)!.n >= 10) throw new CallError('Hay diez preparaciones pendientes. Espere o cancele una.', 409)
    const profile = this.tts.profile()
    const input: JobInput = { title: '', text: '', variantId: randomUUID(), regenerate: body.regenerate === true }
    if (operation === 'intro') {
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
      db.run(`INSERT INTO karaokeCallJobs(id,roomId,requestId,operation,requestJSON,inputJSON,profileJSON,text,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?)`,
        [id, roomId, body.requestId, operation, requestJSON, JSON.stringify(input), JSON.stringify(profile), input.text, now, now])
      db.exec('RELEASE call_submit')
    } catch (error) {
      db.exec('ROLLBACK TO call_submit; RELEASE call_submit')
      throw error
    }
    void this.tick()
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
    const row = db.get<JobRow>('SELECT * FROM karaokeCallJobs WHERE status=\'queued\' AND retryAt<=? ORDER BY rowid LIMIT 1', [Date.now()])
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
      db.run(`INSERT INTO karaokeCallParts(id,roomId,kind,variantId,title,text,profileKey,cacheKey,master,filename,checksum,masterChecksum,durationMs,dependenciesJSON,createdAt)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [output.id, row.roomId, kind, input.variantId, input.title, text,
        key(JSON.parse(row.profileJSON)), cacheKey, output.master, output.filename, output.checksum, output.masterChecksum, output.durationMs, JSON.stringify(dependencies), Date.now()])
      return part(row.roomId, output.id)!
    } catch (error) {
      await Promise.all([output.master, output.filename].map(file => fs.rm(path.join(this.directory, file), { force: true })))
      throw error
    }
  }

  private async generatePart (row: JobRow, purpose: CallPurpose, text: string) {
    const input: JobInput = JSON.parse(row.inputJSON)
    const profile: GreetingVoiceProfile = JSON.parse(row.profileJSON)
    const cacheKey = key([purpose, text, callSpeechProfile(profile, purpose), compositionRevision, ['intro', 'table'].includes(purpose) ? input.variantId : null])
    const cached = !input.regenerate && db.get<PartRow>('SELECT * FROM karaokeCallParts WHERE roomId=? AND cacheKey=? AND retired=0 ORDER BY rowid DESC LIMIT 1', [row.roomId, cacheKey])
    if (cached) {
      await this.bytes(row.roomId, cached.id, true)
      await this.bytes(row.roomId, cached.id)
      return cached
    }
    this.assertCurrent(row)
    db.run('UPDATE karaokeCallJobs SET status=\'generating\',error=NULL,updatedAt=? WHERE id=?', [Date.now(), row.id])
    const started = Date.now()
    let bytes: Buffer
    try {
      bytes = await this.tts.generate(text, profile, this.controller!.signal, true, purpose)
    } finally {
      db.run('UPDATE karaokeCallJobs SET providerMs=providerMs+? WHERE id=?', [Date.now() - started, row.id])
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
      if (row.operation === 'hybrid') {
        const intro = part(row.roomId, input.introId!)
        const table = part(row.roomId, input.tablePartId!)
        if (!intro || !table) throw new CallError('Una pieza ya no está disponible.')
        const continuation = await this.generatePart(row, 'continuation', input.continuation!)
        this.assertCurrent(row)
        const pieces = [intro, table, continuation]
        const cacheKey = key([pieces.map(piece => piece.masterChecksum), compositionRevision])
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
        db.exec('RELEASE call_ready')
      } catch (error) {
        db.exec('ROLLBACK TO call_ready; RELEASE call_ready')
        throw error
      }
    } catch (error) {
      if (job(row.roomId, row.id)?.status !== 'cancelled') {
        if (!this.stopped && error instanceof GreetingVoiceError && ['busy', 'rate'].includes(error.kind) && !error.attempted) {
          db.run('UPDATE karaokeCallJobs SET status=\'queued\',retryAt=?,error=?,updatedAt=? WHERE id=?', [Math.max(Date.now() + 1000, error.retryAt), error.message, Date.now(), row.id])
        } else {
          const uncertain = this.stopped || (error instanceof GreetingVoiceError && error.kind === 'uncertain')
          const message = error instanceof CallError || error instanceof AudioValidationError || error instanceof GreetingVoiceError ? error.message : 'No se pudo procesar el audio. Revise FFmpeg y vuelva a preparar.'
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

  private async cleanup () {
    const keep = new Set<string>()
    for (const { roomId } of db.all<{ roomId: number }>('SELECT DISTINCT roomId FROM karaokeCallParts')) {
      for (const item of intros(roomId)) keep.add(item.id)
      for (const row of db.all<{ partId: string }>('SELECT partId FROM tableCallVoices WHERE roomId=? AND partId IS NOT NULL', [roomId])) keep.add(row.partId)
      const recent = db.all<JobRow>(`SELECT * FROM karaokeCallJobs WHERE roomId=? AND operation IN ('hybrid','reference') AND status='ready' ORDER BY rowid DESC LIMIT 10`, [roomId])
      for (const row of [...recent, ...db.all<JobRow>(`SELECT * FROM karaokeCallJobs WHERE roomId=? AND status IN ${active}`, [roomId])]) {
        if (row.resultId) keep.add(row.resultId)
        const input: JobInput = JSON.parse(row.inputJSON)
        if (input.introId) keep.add(input.introId)
        if (input.tablePartId) keep.add(input.tablePartId)
      }
    }
    const rows = db.all<PartRow>('SELECT * FROM karaokeCallParts WHERE retired=0')
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
